import type {
  SiteTrackerClient,
  SiteTrackerDeliveryResult,
  SiteTrackerEvents,
  SiteTrackerEventInput,
  SiteTrackerEventType,
  ViewMendOptions,
} from './types.js';
import type {
  CronClient,
  CronCallback,
  CronCallbackHeaders,
  CronRegistrationInput,
  CronRegistrationResult,
  CronRequestOptions,
} from './cron-types.js';
import { CronCallbackVerifier } from './cron-callback.js';
import {
  parseCurrentRegistration,
  parseRegistration,
  registrationBody,
  validateCronOptions,
} from './internal/cron.js';
import type {
  SiteTrackerDashboardOptions,
  SiteTrackerDashboardResult,
  SiteTrackerResourcesOptions,
  SiteTrackerResourcesResult,
} from './site-tracker-types.js';
import { HttpTransport, encodePathSegment } from './internal/transport.js';
import { dashboardQuery, resourcesQuery } from './internal/site-tracker-query.js';
import { parseDashboard, parseResources } from './internal/site-tracker-response.js';
import {
  validateClientOptions,
  validateEventInput,
  validateIntegrationId,
} from './internal/validation.js';

declare const __VIEWMEND_SDK_VERSION__: string;

export class ViewMend {
  readonly #transport: HttpTransport;
  readonly #apiToken: string;

  public constructor(options: ViewMendOptions) {
    const config = validateClientOptions(options);
    this.#transport = new HttpTransport(config, __VIEWMEND_SDK_VERSION__);
    this.#apiToken = config.apiToken;
    Object.freeze(this);
  }

  public siteTracker(integrationId: string): SiteTrackerClient {
    return new SiteTrackerModule(this.#transport, validateIntegrationId(integrationId));
  }

  public cron(): CronClient {
    return new CronModule(this.#transport, this.#apiToken);
  }
}

class CronModule implements CronClient {
  readonly #transport: HttpTransport;
  readonly #apiToken: string;

  public constructor(transport: HttpTransport, apiToken: string) {
    this.#transport = transport;
    this.#apiToken = apiToken;
    Object.freeze(this);
  }

  public async register(input: CronRegistrationInput): Promise<CronRegistrationResult> {
    const body = registrationBody(input);
    return this.#transport.request(
      {
        method: 'PUT',
        path: '/cron/registration',
        kind: 'cron',
        body,
        successStatuses: [200, 201],
        parse: (_response, text) => parseRegistration(text),
      },
      input.signal,
    );
  }

  public async current(options: CronRequestOptions = {}): Promise<CronRegistrationResult | null> {
    validateCronOptions(options);
    return this.#transport.request(
      {
        method: 'GET',
        path: '/cron/registration',
        kind: 'cron',
        successStatuses: [200, 404],
        parse: parseCurrentRegistration,
      },
      options.signal,
    );
  }

  public async disable(options: CronRequestOptions = {}): Promise<void> {
    validateCronOptions(options);
    return this.#transport.request(
      {
        method: 'DELETE',
        path: '/cron/registration',
        kind: 'cron',
        successStatuses: [204],
        parse: () => undefined,
      },
      options.signal,
    );
  }

  public async verifyCallback(
    headers: CronCallbackHeaders,
    rawBody: string | Uint8Array,
  ): Promise<CronCallback> {
    return CronCallbackVerifier.fromToken(this.#apiToken).verify(headers, rawBody);
  }
}

class SiteTrackerModule implements SiteTrackerClient {
  public readonly events: SiteTrackerEvents;
  readonly #transport: HttpTransport;
  readonly #path: string;

  public constructor(transport: HttpTransport, integrationId: string) {
    this.#transport = transport;
    this.#path = `/site-tracker/integrations/${encodePathSegment(integrationId)}`;
    this.events = new EventsModule(transport, integrationId);
    Object.freeze(this);
  }

  public async dashboard(
    options: SiteTrackerDashboardOptions = {},
  ): Promise<SiteTrackerDashboardResult> {
    const path = this.#path + dashboardQuery(options);
    return this.#transport.request(
      {
        method: 'GET',
        path,
        kind: 'query',
        successStatuses: [200],
        parse: (_response, body) => parseDashboard(body),
      },
      options.signal,
    );
  }

  public async resources(
    options: SiteTrackerResourcesOptions,
  ): Promise<SiteTrackerResourcesResult> {
    const path = this.#path + resourcesQuery(options);
    return this.#transport.request(
      {
        method: 'GET',
        path,
        kind: 'query',
        successStatuses: [200],
        parse: (_response, body) => parseResources(body),
      },
      options.signal,
    );
  }
}

class EventsModule implements SiteTrackerEvents {
  readonly #transport: HttpTransport;
  readonly #integrationId: string;

  public constructor(transport: HttpTransport, integrationId: string) {
    this.#transport = transport;
    this.#integrationId = integrationId;
    Object.freeze(this);
  }

  public deployment(input: SiteTrackerEventInput): Promise<SiteTrackerDeliveryResult> {
    return this.#send('deployment', input);
  }

  public contentUpdate(input: SiteTrackerEventInput): Promise<SiteTrackerDeliveryResult> {
    return this.#send('content_update', input);
  }

  public pluginUpdate(input: SiteTrackerEventInput): Promise<SiteTrackerDeliveryResult> {
    return this.#send('plugin_update', input);
  }

  public themeUpdate(input: SiteTrackerEventInput): Promise<SiteTrackerDeliveryResult> {
    return this.#send('theme_update', input);
  }

  public cacheCleared(input: SiteTrackerEventInput): Promise<SiteTrackerDeliveryResult> {
    return this.#send('cache_cleared', input);
  }

  public trackingScriptChange(input: SiteTrackerEventInput): Promise<SiteTrackerDeliveryResult> {
    return this.#send('tracking_script_change', input);
  }

  public maintenance(input: SiteTrackerEventInput): Promise<SiteTrackerDeliveryResult> {
    return this.#send('maintenance', input);
  }

  public custom(input: SiteTrackerEventInput): Promise<SiteTrackerDeliveryResult> {
    return this.#send('custom', input);
  }

  async #send(
    eventType: SiteTrackerEventType,
    input: SiteTrackerEventInput,
  ): Promise<SiteTrackerDeliveryResult> {
    const event = validateEventInput(input);
    const signal = readSignal(input);
    return await this.#transport.sendEvent(this.#integrationId, eventType, event, signal);
  }
}

function readSignal(input: SiteTrackerEventInput): AbortSignal | undefined {
  const signal = input.signal;
  if (signal === undefined) {
    return undefined;
  }
  return signal;
}
