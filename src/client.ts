import type {
  SiteTrackerClient,
  SiteTrackerDeliveryResult,
  SiteTrackerEvents,
  SiteTrackerEventInput,
  SiteTrackerEventType,
  ViewMendOptions,
} from './types.js';
import { HttpTransport } from './internal/transport.js';
import {
  validateClientOptions,
  validateEventInput,
  validateIntegrationId,
} from './internal/validation.js';

declare const __VIEWMEND_SDK_VERSION__: string;

export class ViewMend {
  readonly #transport: HttpTransport;

  public constructor(options: ViewMendOptions) {
    this.#transport = new HttpTransport(validateClientOptions(options), __VIEWMEND_SDK_VERSION__);
    Object.freeze(this);
  }

  public siteTracker(integrationId: string): SiteTrackerClient {
    return new SiteTrackerModule(this.#transport, validateIntegrationId(integrationId));
  }
}

class SiteTrackerModule implements SiteTrackerClient {
  public readonly events: SiteTrackerEvents;

  public constructor(transport: HttpTransport, integrationId: string) {
    this.events = new EventsModule(transport, integrationId);
    Object.freeze(this);
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
