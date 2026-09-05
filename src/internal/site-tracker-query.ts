import { ViewMendValidationError } from '../errors.js';
import type {
  SiteTrackerDashboardOptions,
  SiteTrackerResourcesOptions,
} from '../site-tracker-types.js';
import { isAbortSignal, validatePathId } from './validation.js';
import { encodePathSegment } from './transport.js';

function optionsObject(
  value: unknown,
  fields: readonly string[],
): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ViewMendValidationError('Site Tracker query options must be an object.');
  }
  if (Object.keys(value).some((key) => !fields.includes(key))) {
    throw new ViewMendValidationError('Unsupported Site Tracker query option.');
  }
  if ('signal' in value && value.signal !== undefined && !isAbortSignal(value.signal)) {
    throw new ViewMendValidationError('signal must be an AbortSignal.', 'signal');
  }
}

function device(value: unknown): string {
  if (value === undefined) return 'desktop';
  if (value !== 'desktop' && value !== 'mobile') {
    throw new ViewMendValidationError('device must be desktop or mobile.', 'device');
  }
  return value;
}

export function dashboardQuery(options: SiteTrackerDashboardOptions): string {
  optionsObject(options, ['pageId', 'device', 'signal']);
  const query = new URLSearchParams();
  if (options.pageId !== undefined && options.pageId !== null) {
    if (
      typeof options.pageId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(options.pageId)
    ) {
      throw new ViewMendValidationError('pageId must be a UUID.', 'pageId');
    }
    query.set('page_id', options.pageId);
  }
  query.set('device', device(options.device));
  return `/dashboard?${query}`;
}

export function resourcesQuery(options: SiteTrackerResourcesOptions): string {
  optionsObject(options, ['runId', 'type', 'device', 'page', 'perPage', 'signal']);
  // The wire contract allows an opaque run ID, encoded as one path segment.
  const runId = validatePathId(options.runId, 'runId');
  if (!['images', 'javascript', 'css', 'other'].includes(options.type)) {
    throw new ViewMendValidationError('type must be images, javascript, css, or other.', 'type');
  }
  const page = options.page === undefined ? 1 : options.page;
  const perPage = options.perPage === undefined ? 50 : options.perPage;
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new ViewMendValidationError('page must be a positive safe integer.', 'page');
  }
  if (!Number.isSafeInteger(perPage) || perPage < 1 || perPage > 300) {
    throw new ViewMendValidationError('perPage must be an integer from 1 to 300.', 'perPage');
  }
  const query = new URLSearchParams({
    type: options.type,
    device: device(options.device),
    page: String(page),
    per_page: String(perPage),
  });
  return `/runs/${encodePathSegment(runId)}/resources?${query}`;
}
