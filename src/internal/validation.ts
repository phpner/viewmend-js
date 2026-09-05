import { ViewMendConfigurationError, ViewMendValidationError } from '../errors.js';
import type {
  FetchLike,
  JsonArray,
  JsonObject,
  JsonValue,
  RetryOptions,
  SiteTrackerEventInput,
  ViewMendOptions,
} from '../types.js';

const EVENT_FIELDS = new Set([
  'id',
  'title',
  'occurredAt',
  'siteUrl',
  'pageUrls',
  'environment',
  'description',
  'referenceUrl',
  'changedFields',
  'metadata',
  'signal',
]);

const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

export interface ValidatedClientConfig {
  readonly apiToken: string;
  readonly apiBaseUrl: string;
  readonly fetch: FetchLike;
  readonly timeoutMs: number;
  readonly retry: Required<RetryOptions>;
}

export interface ValidatedEvent {
  readonly id: string;
  readonly title: string;
  readonly occurredAt?: string;
  readonly siteUrl?: string;
  readonly pageUrls?: readonly string[];
  readonly environment?: string;
  readonly description?: string;
  readonly referenceUrl?: string;
  readonly changedFields?: readonly string[];
  readonly metadata?: JsonObject | JsonArray;
}

export function validateClientOptions(options: ViewMendOptions): ValidatedClientConfig {
  if (!isRecord(options)) {
    throw new ViewMendConfigurationError('ViewMend options must be an object.');
  }

  const apiToken = options.apiToken;
  if (
    typeof apiToken !== 'string' ||
    apiToken.length === 0 ||
    apiToken.length > 4096 ||
    hasControlCharacters(apiToken)
  ) {
    throw new ViewMendConfigurationError('The ViewMend API token is invalid.');
  }

  const apiBaseUrl = validateApiBaseUrl(options.apiBaseUrl ?? 'https://viewmend.com/api/v1');
  const fetchImplementation = options.fetch ?? globalThis.fetch?.bind(globalThis);
  if (typeof fetchImplementation !== 'function') {
    throw new ViewMendConfigurationError(
      'A standards-compatible fetch implementation is required in this runtime.',
    );
  }

  const timeoutMs = options.timeoutMs ?? 10_000;
  assertIntegerInRange(timeoutMs, 1, 300_000, 'timeoutMs');

  const retry = validateRetryOptions(options.retry);

  return Object.freeze({
    apiToken,
    apiBaseUrl,
    fetch: fetchImplementation,
    timeoutMs,
    retry,
  });
}

export function validateIntegrationId(value: string): string {
  return validatePathId(value, 'Site Tracker integration ID');
}

export function validatePathId(value: string, field: string): string {
  const result = assertString(value, field, 255, true);
  if (
    result === '.' ||
    result === '..' ||
    [...result].some((character) => {
      const point = character.codePointAt(0) ?? 0;
      return point >= 0xd800 && point <= 0xdfff;
    })
  ) {
    throw new ViewMendValidationError(`${field} is invalid.`, field);
  }
  return result;
}

export function validateEventInput(input: SiteTrackerEventInput): ValidatedEvent {
  if (!isRecord(input)) {
    throw new ViewMendValidationError('The Site Tracker event must be an object.');
  }

  for (const field of Object.keys(input)) {
    if (!EVENT_FIELDS.has(field)) {
      throw new ViewMendValidationError(`Unsupported Site Tracker event field: ${field}.`, field);
    }
  }

  const result: {
    id: string;
    title: string;
    occurredAt?: string;
    siteUrl?: string;
    pageUrls?: readonly string[];
    environment?: string;
    description?: string;
    referenceUrl?: string;
    changedFields?: readonly string[];
    metadata?: JsonObject | JsonArray;
  } = {
    id: assertString(input.id, 'id', 160, true),
    title: assertString(input.title, 'title', 140, true),
  };

  if (input.occurredAt !== undefined) {
    result.occurredAt = validateOccurredAt(input.occurredAt);
  }
  if (input.siteUrl !== undefined) {
    result.siteUrl = validateHttpUrl(input.siteUrl, 'siteUrl');
  }
  if (input.pageUrls !== undefined) {
    result.pageUrls = validatePageUrls(input.pageUrls);
  }
  if (input.environment !== undefined) {
    result.environment = assertString(input.environment, 'environment', 60, false);
  }
  if (input.description !== undefined) {
    result.description = assertString(input.description, 'description', 2000, false);
  }
  if (input.referenceUrl !== undefined) {
    result.referenceUrl = validateHttpUrl(input.referenceUrl, 'referenceUrl');
  }
  if (input.changedFields !== undefined) {
    result.changedFields = validateChangedFields(input.changedFields);
  }
  if (input.metadata !== undefined) {
    const cloned = cloneJsonValue(input.metadata, new WeakSet(), 0, 'metadata');
    if (!Array.isArray(cloned) && !isRecord(cloned)) {
      throw new ViewMendValidationError('metadata must be a JSON object or array.', 'metadata');
    }
    result.metadata = cloned as JsonObject | JsonArray;
  }
  if (input.signal !== undefined && !isAbortSignal(input.signal)) {
    throw new ViewMendValidationError('signal must be an AbortSignal.', 'signal');
  }

  return Object.freeze(result);
}

export function assertPayloadSize(body: string): void {
  if (new TextEncoder().encode(body).byteLength > 65_536) {
    throw new ViewMendValidationError(
      'The Site Tracker event payload exceeds the 65536-byte API limit.',
    );
  }
}

function validateApiBaseUrl(value: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ViewMendConfigurationError('The API base URL is invalid.');
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ViewMendConfigurationError('The API base URL is invalid.');
  }

  if (
    (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
    parsed.hostname === '' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    throw new ViewMendConfigurationError(
      'The API base URL must be an absolute HTTP(S) URL without credentials, query, or fragment.',
    );
  }

  return value.replace(/\/+$/, '');
}

function validateRetryOptions(value: false | RetryOptions | undefined): Required<RetryOptions> {
  if (value === false) {
    return Object.freeze({ maxAttempts: 1, baseDelayMs: 250, maxDelayMs: 30_000 });
  }
  if (value !== undefined && !isRecord(value)) {
    throw new ViewMendConfigurationError('retry must be false or a retry options object.');
  }

  const options: RetryOptions = value ?? {};
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 250;
  const maxDelayMs = options.maxDelayMs ?? 30_000;
  assertIntegerInRange(maxAttempts, 1, 10, 'retry.maxAttempts');
  assertIntegerInRange(baseDelayMs, 0, 60_000, 'retry.baseDelayMs');
  assertIntegerInRange(maxDelayMs, 0, 300_000, 'retry.maxDelayMs');
  if (maxDelayMs < baseDelayMs) {
    throw new ViewMendConfigurationError(
      'retry.maxDelayMs must be greater than or equal to retry.baseDelayMs.',
    );
  }

  return Object.freeze({ maxAttempts, baseDelayMs, maxDelayMs });
}

function validateOccurredAt(value: string | Date): string {
  let serialized: string;
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) {
      throw new ViewMendValidationError('occurredAt must be a valid date.', 'occurredAt');
    }
    serialized = value.toISOString();
  } else {
    serialized = assertString(value, 'occurredAt', 64, true);
    if (!ISO_8601.test(serialized)) {
      throw new ViewMendValidationError(
        'occurredAt must be an ISO 8601 date-time with a timezone.',
        'occurredAt',
      );
    }
  }

  const timestamp = Date.parse(serialized);
  if (!Number.isFinite(timestamp)) {
    throw new ViewMendValidationError(
      'occurredAt must be a valid ISO 8601 date-time.',
      'occurredAt',
    );
  }
  if (timestamp > Date.now() + 5 * 60_000) {
    throw new ViewMendValidationError(
      'occurredAt cannot be more than five minutes in the future.',
      'occurredAt',
    );
  }

  return serialized;
}

function validatePageUrls(value: readonly string[]): readonly string[] {
  if (!Array.isArray(value)) {
    throw new ViewMendValidationError('pageUrls must be an array.', 'pageUrls');
  }
  if (value.length > 20) {
    throw new ViewMendValidationError('pageUrls must not contain more than 20 URLs.', 'pageUrls');
  }

  const seen = new Set<string>();
  const urls = value.map((url) => {
    const validated = validateHttpUrl(url, 'pageUrls');
    const normalized = new URL(validated).href;
    if (seen.has(normalized)) {
      throw new ViewMendValidationError('pageUrls must not contain duplicate URLs.', 'pageUrls');
    }
    seen.add(normalized);
    return validated;
  });

  return Object.freeze(urls);
}

function validateChangedFields(value: readonly string[]): readonly string[] {
  if (!Array.isArray(value)) {
    throw new ViewMendValidationError('changedFields must be an array.', 'changedFields');
  }
  if (value.length > 50) {
    throw new ViewMendValidationError(
      'changedFields must not contain more than 50 items.',
      'changedFields',
    );
  }

  const seen = new Set<string>();
  const fields = value.map((field) => {
    const validated = assertString(field, 'changedFields item', 120, false);
    if (seen.has(validated)) {
      throw new ViewMendValidationError(
        'changedFields must not contain duplicate items.',
        'changedFields',
      );
    }
    seen.add(validated);
    return validated;
  });

  return Object.freeze(fields);
}

function validateHttpUrl(value: string, field: string): string {
  const validated = assertString(value, field, 2048, true);
  let parsed: URL;
  try {
    parsed = new URL(validated);
  } catch {
    throw new ViewMendValidationError(`${field} must be an absolute HTTP(S) URL.`, field);
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.hostname === '') {
    throw new ViewMendValidationError(`${field} must be an absolute HTTP(S) URL.`, field);
  }
  return validated;
}

function assertString(value: unknown, field: string, maxLength: number, notBlank: boolean): string {
  if (typeof value !== 'string') {
    throw new ViewMendValidationError(`${field} must be a string.`, field);
  }
  if (notBlank && value.trim() === '') {
    throw new ViewMendValidationError(`${field} must not be blank.`, field);
  }
  if ([...value].length > maxLength) {
    throw new ViewMendValidationError(`${field} must not exceed ${maxLength} characters.`, field);
  }
  return value;
}

function assertIntegerInRange(
  value: unknown,
  minimum: number,
  maximum: number,
  field: string,
): void {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new ViewMendConfigurationError(
      `${field} must be an integer between ${minimum} and ${maximum}.`,
    );
  }
}

function cloneJsonValue(
  value: unknown,
  seen: WeakSet<object>,
  depth: number,
  field: string,
): JsonValue {
  if (depth > 60) {
    throw new ViewMendValidationError(`${field} is nested too deeply.`, field);
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ViewMendValidationError(`${field} must contain finite JSON numbers.`, field);
    }
    return value;
  }
  if (typeof value !== 'object') {
    throw new ViewMendValidationError(`${field} must be JSON-serializable.`, field);
  }
  if (seen.has(value)) {
    throw new ViewMendValidationError(`${field} must not contain circular references.`, field);
  }

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return Object.freeze(
        value.map((item) => cloneJsonValue(item, seen, depth + 1, field)),
      ) as JsonArray;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new ViewMendValidationError(
        `${field} must contain only JSON objects and arrays.`,
        field,
      );
    }

    const output: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value)) {
      output[key] = cloneJsonValue(item, seen, depth + 1, field);
    }
    return Object.freeze(output);
  } finally {
    seen.delete(value);
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

export function isAbortSignal(value: unknown): value is AbortSignal {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { aborted?: unknown }).aborted === 'boolean' &&
    typeof (value as { addEventListener?: unknown }).addEventListener === 'function' &&
    typeof (value as { removeEventListener?: unknown }).removeEventListener === 'function'
  );
}
