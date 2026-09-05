import type {
  SiteTrackerDashboardOptions,
  SiteTrackerDashboardResult,
  SiteTrackerResourcesOptions,
  SiteTrackerResourcesResult,
} from './site-tracker-types.js';

export const siteTrackerEventTypes = Object.freeze([
  'deployment',
  'content_update',
  'plugin_update',
  'theme_update',
  'cache_cleared',
  'tracking_script_change',
  'maintenance',
  'custom',
] as const);

export type SiteTrackerEventType = (typeof siteTrackerEventTypes)[number];

export const knownQueueStatuses = Object.freeze([
  'recorded',
  'queued',
  'waiting_for_credits',
  'waiting_for_pages',
  'paused',
  'processed',
  'cancelled',
  'ignored_no_matching_pages',
  'ignored_no_active_pages',
] as const);

export type KnownQueueStatus = (typeof knownQueueStatuses)[number];

export function isKnownQueueStatus(status: string): status is KnownQueueStatus {
  return (knownQueueStatuses as readonly string[]).includes(status);
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export interface JsonObject {
  readonly [key: string]: JsonValue;
}
export interface JsonArray extends ReadonlyArray<JsonValue> {}

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface RetryOptions {
  /** Total request attempts, including the first request. Defaults to 3. */
  readonly maxAttempts?: number;
  /** Initial exponential backoff delay. Defaults to 250 milliseconds. */
  readonly baseDelayMs?: number;
  /** Maximum backoff or Retry-After delay. Defaults to 30 seconds. */
  readonly maxDelayMs?: number;
}

export interface ViewMendOptions {
  readonly apiToken: string;
  readonly apiBaseUrl?: string;
  readonly fetch?: FetchLike;
  /** Timeout for each request attempt. Defaults to 10 seconds. */
  readonly timeoutMs?: number;
  /** Set to false to disable retries. */
  readonly retry?: false | RetryOptions;
}

export interface SiteTrackerEventInput {
  /** Stable identifier from the originating system. Reuse it when retrying the same event. */
  readonly id: string;
  readonly title: string;
  readonly occurredAt?: string | Date;
  readonly siteUrl?: string;
  readonly pageUrls?: readonly string[];
  readonly environment?: string;
  readonly description?: string;
  readonly referenceUrl?: string;
  readonly changedFields?: readonly string[];
  readonly metadata?: JsonObject | JsonArray;
  /** Cancels this delivery, including retry backoff. */
  readonly signal?: AbortSignal;
}

export interface SiteTrackerDeliveryResult {
  readonly deliveryId: string;
  readonly eventId: string;
  readonly duplicate: boolean;
  readonly affectedPages: number;
  readonly ignoredUrls: number;
  readonly checksQueued: number;
  /** Unknown future statuses are preserved as strings. */
  readonly queueStatus: string;
  readonly scheduledFor: string | null;
}

export interface SiteTrackerEvents {
  deployment(input: SiteTrackerEventInput): Promise<SiteTrackerDeliveryResult>;
  contentUpdate(input: SiteTrackerEventInput): Promise<SiteTrackerDeliveryResult>;
  pluginUpdate(input: SiteTrackerEventInput): Promise<SiteTrackerDeliveryResult>;
  themeUpdate(input: SiteTrackerEventInput): Promise<SiteTrackerDeliveryResult>;
  cacheCleared(input: SiteTrackerEventInput): Promise<SiteTrackerDeliveryResult>;
  trackingScriptChange(input: SiteTrackerEventInput): Promise<SiteTrackerDeliveryResult>;
  maintenance(input: SiteTrackerEventInput): Promise<SiteTrackerDeliveryResult>;
  custom(input: SiteTrackerEventInput): Promise<SiteTrackerDeliveryResult>;
}

export interface SiteTrackerClient {
  readonly events: SiteTrackerEvents;
  dashboard(options?: SiteTrackerDashboardOptions): Promise<SiteTrackerDashboardResult>;
  resources(options: SiteTrackerResourcesOptions): Promise<SiteTrackerResourcesResult>;
}
