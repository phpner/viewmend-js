import {
  ViewMendAbortError,
  ViewMendApiError,
  ViewMendAuthenticationError,
  ViewMendAuthorizationError,
  ViewMendConflictError,
  ViewMendEndpointDisabledError,
  ViewMendError,
  ViewMendInvalidResponseError,
  ViewMendNetworkError,
  ViewMendNotFoundError,
  ViewMendPayloadTooLargeError,
  ViewMendRateLimitError,
  ViewMendResourceNotFoundError,
  ViewMendServerError,
  ViewMendTimeoutError,
  ViewMendTokenScopeError,
  ViewMendUnprocessableEventError,
  ViewMendUnprocessableQueryError,
  ViewMendUnprocessableRegistrationError,
} from '../errors.js';
import type { SiteTrackerDeliveryResult, SiteTrackerEventType } from '../types.js';
import { exponentialDelay, parseRetryAfter, TRANSIENT_STATUSES, waitForRetry } from './retry.js';
import type { ValidatedClientConfig, ValidatedEvent } from './validation.js';
import { assertPayloadSize } from './validation.js';

const MAX_RESPONSE_BYTES = 1_048_576;
const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

interface AttemptSignal {
  readonly signal: AbortSignal;
  readonly cleanup: () => void;
  readonly abortedByCaller: () => boolean;
  readonly timedOut: () => boolean;
}

class AttemptAbortedError extends Error {}

interface ApiRequest<T> {
  readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  readonly path: string;
  readonly body?: string;
  readonly kind: 'event' | 'query' | 'cron';
  readonly successStatuses: readonly number[];
  readonly parse: (response: Response, body: string) => T;
}

export class HttpTransport {
  readonly #config: ValidatedClientConfig;
  readonly #sdkVersion: string;

  public constructor(config: ValidatedClientConfig, sdkVersion: string) {
    this.#config = config;
    this.#sdkVersion = sdkVersion;
  }

  public async sendEvent(
    integrationId: string,
    eventType: SiteTrackerEventType,
    event: ValidatedEvent,
    signal?: AbortSignal,
  ): Promise<SiteTrackerDeliveryResult> {
    const body = serializeEvent(eventType, event);
    assertPayloadSize(body);
    const pathSegment = encodePathSegment(integrationId);
    return this.request(
      {
        method: 'POST',
        path: `/site-tracker/integrations/${pathSegment}/events`,
        body,
        kind: 'event',
        successStatuses: [200, 202],
        parse: parseSuccess,
      },
      signal,
    );
  }

  public async request<T>(request: ApiRequest<T>, signal?: AbortSignal): Promise<T> {
    const url = `${this.#config.apiBaseUrl}${request.path}`;

    for (let attempt = 1; attempt <= this.#config.retry.maxAttempts; attempt += 1) {
      if (signal?.aborted) {
        throw new ViewMendAbortError('The ViewMend request was cancelled.');
      }

      const attemptSignal = createAttemptSignal(signal, this.#config.timeoutMs);
      let mayRetryAttemptFailure = true;
      let retryDelayMs: number | undefined;
      try {
        const response = await awaitWithSignal(
          this.#config.fetch(url, {
            method: request.method,
            headers: this.#headers(request.body !== undefined),
            ...(request.body === undefined ? {} : { body: request.body }),
            redirect: 'error',
            signal: attemptSignal.signal,
          }),
          attemptSignal.signal,
        );

        if (!isResponseLike(response)) {
          throw new ViewMendInvalidResponseError('ViewMend returned an invalid HTTP response.', 0);
        }

        if (TRANSIENT_STATUSES.has(response.status) && attempt < this.#config.retry.maxAttempts) {
          const retryAfterMs =
            response.status === 429
              ? parseRetryAfter(response.headers.get('Retry-After'))
              : undefined;
          retryDelayMs = Math.min(
            retryAfterMs ?? this.#retryDelay(attempt),
            this.#config.retry.maxDelayMs,
          );
          await awaitWithSignal(discardResponse(response), attemptSignal.signal);
        } else if (request.successStatuses.includes(response.status)) {
          const responseBody = await awaitWithSignal(
            readBoundedBody(response),
            attemptSignal.signal,
          );
          try {
            return request.parse(response, responseBody);
          } catch (error) {
            if (request.kind === 'cron' && error instanceof ViewMendInvalidResponseError) {
              throw new ViewMendInvalidResponseError(
                'ViewMend returned a malformed Cron response.',
                response.status,
                undefined,
                safeHeader(response, 'X-Request-Id'),
              );
            }
            throw error;
          }
        } else {
          mayRetryAttemptFailure = false;
          throw await awaitWithSignal(mapApiError(response, request.kind), attemptSignal.signal);
        }
      } catch (error) {
        const normalizedError = normalizeAttemptError(error, attemptSignal);
        if (
          (normalizedError instanceof ViewMendNetworkError ||
            normalizedError instanceof ViewMendTimeoutError) &&
          mayRetryAttemptFailure &&
          attempt < this.#config.retry.maxAttempts
        ) {
          retryDelayMs ??= this.#retryDelay(attempt);
        } else {
          throw normalizedError;
        }
      } finally {
        attemptSignal.cleanup();
      }

      if (retryDelayMs !== undefined) {
        await waitForRetry(retryDelayMs, signal);
      }
    }

    throw new ViewMendNetworkError('The ViewMend API could not be reached.');
  }

  #headers(hasBody: boolean): Headers {
    const headers = new Headers({
      Accept: 'application/json',
      Authorization: `Bearer ${this.#config.apiToken}`,
      'X-ViewMend-SDK': `viewmend-js/${this.#sdkVersion}`,
    });
    if (hasBody) headers.set('Content-Type', 'application/json');

    const processValue = (globalThis as { process?: { versions?: { node?: string } } }).process;
    if (typeof processValue?.versions?.node === 'string') {
      headers.set('User-Agent', `viewmend-js/${this.#sdkVersion}`);
    }

    return headers;
  }

  #retryDelay(attemptsMade: number): number {
    return exponentialDelay(
      attemptsMade,
      this.#config.retry.baseDelayMs,
      this.#config.retry.maxDelayMs,
    );
  }
}

function serializeEvent(eventType: SiteTrackerEventType, event: ValidatedEvent): string {
  const payload: Record<string, unknown> = {
    event_id: event.id,
    event_type: eventType,
    title: event.title,
  };
  if (event.occurredAt !== undefined) payload.occurred_at = event.occurredAt;
  if (event.siteUrl !== undefined) payload.site_url = event.siteUrl;
  if (event.pageUrls !== undefined && event.pageUrls.length > 0) payload.page_urls = event.pageUrls;
  if (event.environment !== undefined) payload.environment = event.environment;
  if (event.description !== undefined) payload.description = event.description;
  if (event.referenceUrl !== undefined) payload.reference_url = event.referenceUrl;
  if (event.changedFields !== undefined && event.changedFields.length > 0) {
    payload.changed_fields = event.changedFields;
  }
  if (event.metadata !== undefined) payload.metadata = event.metadata;
  return JSON.stringify(payload);
}

function createAttemptSignal(
  userSignal: AbortSignal | undefined,
  timeoutMs: number,
): AttemptSignal {
  const controller = new AbortController();
  let didAbortByCaller = false;
  let didTimeout = false;
  const timeout = setTimeout(() => {
    if (controller.signal.aborted) return;
    didTimeout = true;
    controller.abort();
  }, timeoutMs);
  const abort = (): void => {
    if (controller.signal.aborted) return;
    didAbortByCaller = true;
    controller.abort();
  };
  if (userSignal?.aborted) {
    abort();
  } else {
    userSignal?.addEventListener('abort', abort, { once: true });
  }

  return {
    signal: controller.signal,
    abortedByCaller: () => didAbortByCaller,
    timedOut: () => didTimeout,
    cleanup: () => {
      clearTimeout(timeout);
      userSignal?.removeEventListener('abort', abort);
    },
  };
}

function awaitWithSignal<T>(operation: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(new AttemptAbortedError());
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      callback();
    };
    const abort = (): void => finish(() => reject(new AttemptAbortedError()));
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(operation).then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}

function normalizeAttemptError(error: unknown, attemptSignal: AttemptSignal): ViewMendError {
  if (attemptSignal.abortedByCaller()) {
    return new ViewMendAbortError('The ViewMend request was cancelled.');
  }
  if (attemptSignal.timedOut()) {
    return new ViewMendTimeoutError('The ViewMend request timed out.');
  }
  if (error instanceof ViewMendError) {
    return error;
  }
  return new ViewMendNetworkError('The ViewMend API could not be reached.');
}

async function readBoundedBody(response: Response): Promise<string> {
  const contentLength = response.headers.get('Content-Length');
  if (contentLength !== null && Number(contentLength) > MAX_RESPONSE_BYTES) {
    throw new ViewMendInvalidResponseError(
      'ViewMend returned an unexpectedly large response.',
      response.status,
      safeHeader(response, 'X-ViewMend-Delivery'),
    );
  }

  let body: string;
  try {
    body = await response.text();
  } catch {
    throw new ViewMendNetworkError('The ViewMend response could not be read.');
  }
  if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) {
    throw new ViewMendInvalidResponseError(
      'ViewMend returned an unexpectedly large response.',
      response.status,
      safeHeader(response, 'X-ViewMend-Delivery'),
    );
  }
  return body;
}

function parseSuccess(response: Response, body: string): SiteTrackerDeliveryResult {
  let data: Record<string, unknown>;
  try {
    data = parseJsonObject(body);
  } catch {
    throw malformed(response);
  }
  const deliveryId = requiredString(data, 'delivery_id', response);
  const headerDeliveryId = safeHeader(response, 'X-ViewMend-Delivery');
  const duplicate = data.duplicate;
  const expectedDuplicate = response.status === 200;

  if (data.ok !== true || headerDeliveryId !== deliveryId || duplicate !== expectedDuplicate) {
    throw malformed(response);
  }

  const scheduledFor = data.scheduled_for;
  if (
    !Object.hasOwn(data, 'scheduled_for') ||
    (scheduledFor !== null &&
      (typeof scheduledFor !== 'string' ||
        !ISO_8601.test(scheduledFor) ||
        !Number.isFinite(Date.parse(scheduledFor))))
  ) {
    throw malformed(response);
  }

  return Object.freeze({
    deliveryId,
    eventId: requiredString(data, 'event_id', response),
    duplicate: expectedDuplicate,
    affectedPages: requiredCounter(data, 'affected_pages', response),
    ignoredUrls: requiredCounter(data, 'ignored_urls', response),
    checksQueued: requiredCounter(data, 'checks_queued', response),
    queueStatus: requiredString(data, 'queue_status', response, 120),
    scheduledFor,
  });
}

async function mapApiError(
  response: Response,
  kind: 'event' | 'query' | 'cron',
): Promise<ViewMendApiError> {
  if (kind === 'cron') return mapCronError(response);
  const deliveryId = safeHeader(response, 'X-ViewMend-Delivery');
  if (kind === 'query') {
    if (response.status === 404) {
      return new ViewMendResourceNotFoundError(
        'The Site Tracker resource was not found in this integration.',
        404,
      );
    }
    if (response.status === 410) {
      return new ViewMendEndpointDisabledError(
        'The ViewMend Site Tracker read endpoint is disabled.',
        410,
      );
    }
    if (response.status === 422) {
      return new ViewMendUnprocessableQueryError(
        'ViewMend rejected the Site Tracker query parameters.',
        422,
      );
    }
  }
  const retryAfterMs = parseRetryAfter(response.headers.get('Retry-After'));
  const fields = response.status === 422 ? await validationFields(response) : [];

  switch (response.status) {
    case 401:
      return new ViewMendAuthenticationError(
        'ViewMend rejected the API credentials.',
        response.status,
        deliveryId,
      );
    case 403:
      return new ViewMendAuthorizationError(
        'The API credentials cannot access this ViewMend resource.',
        response.status,
        deliveryId,
      );
    case 404:
      return new ViewMendNotFoundError(
        'The ViewMend Site Tracker integration was not found.',
        response.status,
        deliveryId,
      );
    case 409:
      return new ViewMendConflictError(
        'The ViewMend request conflicts with the current resource state.',
        response.status,
        deliveryId,
      );
    case 410:
      return new ViewMendEndpointDisabledError(
        'The ViewMend event endpoint is disabled.',
        response.status,
        deliveryId,
      );
    case 413:
      return new ViewMendPayloadTooLargeError(
        'The ViewMend event payload is too large.',
        response.status,
        deliveryId,
      );
    case 422:
      return new ViewMendUnprocessableEventError(
        'ViewMend could not apply the event payload.',
        response.status,
        deliveryId,
        fields,
      );
    case 429:
      return new ViewMendRateLimitError(
        'The ViewMend API rate limit was reached.',
        response.status,
        deliveryId,
        retryAfterMs,
      );
    default:
      if (response.status >= 500) {
        return new ViewMendServerError(
          'ViewMend could not process the API request.',
          response.status,
          deliveryId,
        );
      }
      return new ViewMendApiError(
        'ViewMend returned an unexpected HTTP status.',
        response.status,
        deliveryId,
      );
  }
}

async function mapCronError(response: Response): Promise<ViewMendApiError> {
  const requestId = safeHeader(response, 'X-Request-Id');
  const status = response.status;
  if (status === 401) {
    let scopeError = false;
    try {
      const document = parseJsonObject(await readBoundedBody(response));
      scopeError = isRecord(document.error) && document.error.code === 'token_scope_invalid';
    } catch {
      // Unreadable error bodies still represent authentication failures.
    }
    return scopeError
      ? new ViewMendTokenScopeError(
          'This Site Tracker token cannot access the Cron API. Use a Cron connection token.',
          status,
          undefined,
          requestId,
        )
      : new ViewMendAuthenticationError(
          'ViewMend rejected the Cron connection token.',
          status,
          undefined,
          requestId,
        );
  }
  if (status === 410)
    return new ViewMendEndpointDisabledError(
      'The ViewMend Cron connection is disabled.',
      status,
      undefined,
      requestId,
    );
  if (status === 422)
    return new ViewMendUnprocessableRegistrationError(
      'ViewMend rejected the Cron schedule.',
      status,
      undefined,
      requestId,
    );
  if (status === 429)
    return new ViewMendRateLimitError(
      'The ViewMend API rate limit was reached.',
      status,
      undefined,
      parseRetryAfter(response.headers.get('Retry-After')),
      requestId,
    );
  if (status >= 500)
    return new ViewMendServerError(
      'ViewMend could not process the Cron request.',
      status,
      undefined,
      requestId,
    );
  return new ViewMendApiError(
    'ViewMend returned an unexpected Cron HTTP status.',
    status,
    undefined,
    requestId,
  );
}

async function validationFields(response: Response): Promise<readonly string[]> {
  let body: string;
  try {
    body = await readBoundedBody(response);
  } catch {
    return Object.freeze([]);
  }
  let data: Record<string, unknown>;
  try {
    data = parseJsonObject(body);
  } catch {
    return Object.freeze([]);
  }
  if (!isRecord(data.errors)) {
    return Object.freeze([]);
  }
  return Object.freeze(
    Object.keys(data.errors)
      .filter((field) => field.length <= 120 && !hasControlCharacters(field))
      .slice(0, 20),
  );
}

function parseJsonObject(body: string): Record<string, unknown> {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    throw new ViewMendInvalidResponseError(
      'ViewMend returned a malformed Site Tracker response.',
      0,
    );
  }
  if (!isRecord(data)) {
    throw new ViewMendInvalidResponseError(
      'ViewMend returned a malformed Site Tracker response.',
      0,
    );
  }
  return data;
}

function requiredString(
  data: Record<string, unknown>,
  key: string,
  response: Response,
  maximum = 255,
): string {
  const value = data[key];
  if (typeof value !== 'string' || value.trim() === '' || [...value].length > maximum) {
    throw malformed(response);
  }
  return value;
}

function requiredCounter(data: Record<string, unknown>, key: string, response: Response): number {
  const value = data[key];
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw malformed(response);
  }
  return value as number;
}

function malformed(response: Response): ViewMendInvalidResponseError {
  return new ViewMendInvalidResponseError(
    'ViewMend returned a malformed Site Tracker response.',
    response.status,
    safeHeader(response, 'X-ViewMend-Delivery'),
  );
}

function safeHeader(response: Response, name: string): string | undefined {
  const value = response.headers.get(name)?.trim();
  if (!value || value.length > 255 || hasControlCharacters(value)) {
    return undefined;
  }
  return value;
}

export function encodePathSegment(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function isResponseLike(value: unknown): value is Response {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { status?: unknown }).status === 'number' &&
    typeof (value as { text?: unknown }).text === 'function' &&
    typeof (value as { headers?: { get?: unknown } }).headers?.get === 'function'
  );
}

async function discardResponse(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The retry is still safe when a custom response body cannot be cancelled.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}
