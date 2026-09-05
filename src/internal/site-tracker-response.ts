import type {
  SiteTrackerDashboardResult,
  SiteTrackerResourcesResult,
} from '../site-tracker-types.js';
import {
  boolean,
  counter,
  finite,
  identifier,
  integer,
  jsonDocument,
  list,
  nullable,
  object,
  pageSize,
  positive,
  record,
  text,
  timestamp,
} from './response.js';

const trackedPage = (value: unknown) =>
  object(value, {
    id: ['id', identifier],
    url: ['url', text],
    lastCheckedAt: ['last_checked_at', nullable(timestamp)],
  });

const check = (value: unknown) =>
  object(value, {
    runId: ['run_id', identifier],
    status: ['status', identifier],
    finishedAt: ['finished_at', nullable(timestamp)],
    hasComparison: ['has_comparison', boolean],
  });

const links = (value: unknown) => {
  // The API emits [] for an integration without active pages.
  if (Array.isArray(value) && value.length === 0) {
    return Object.freeze({
      issues: null,
      issueHistory: null,
      resourceHistory: null,
      performanceHistory: null,
    });
  }
  return object(value, {
    issues: ['issues', nullable(text)],
    issueHistory: ['issue_history', nullable(text)],
    resourceHistory: ['resource_history', nullable(text)],
    performanceHistory: ['performance_history', nullable(text)],
  });
};

const attentionItem = (value: unknown) =>
  object(value, {
    id: ['id', identifier],
    source: ['source', identifier],
    severity: ['severity', identifier],
    title: ['title', text],
    message: ['message', nullable(text)],
    status: ['status', identifier],
    pageId: ['page_id', identifier],
    pageUrl: ['page_url', nullable(text)],
    occurredAt: ['occurred_at', nullable(timestamp)],
  });

const issueTrend = (value: unknown) =>
  object(value, {
    runId: ['run_id', identifier],
    finishedAt: ['finished_at', nullable(timestamp)],
    critical: ['critical', counter],
    warning: ['warning', counter],
  });

const category = (value: unknown) =>
  object(value, {
    key: ['key', identifier],
    bytes: ['bytes', counter],
    requests: ['requests', counter],
  });

const resourceChange = (value: unknown) =>
  object(value, {
    changeType: ['change_type', identifier],
    resourceType: ['resource_type', identifier],
    url: ['url', text],
    mimeType: ['mime_type', nullable(text)],
    beforeBytes: ['before_bytes', nullable(integer)],
    afterBytes: ['after_bytes', nullable(integer)],
    deltaBytes: ['delta_bytes', nullable(integer)],
    beforeStatus: ['before_status', nullable(integer)],
    afterStatus: ['after_status', nullable(integer)],
  });

const performance = (value: unknown) =>
  object(value, {
    runId: ['run_id', identifier],
    finishedAt: ['finished_at', nullable(timestamp)],
    performanceScore: ['performance_score', nullable(integer)],
    lcpMs: ['lcp_ms', nullable(finite)],
    cls: ['cls', nullable(finite)],
    totalBlockingTimeMs: ['total_blocking_time_ms', nullable(finite)],
  });

const resourceItem = (value: unknown) =>
  object(value, {
    url: ['url', text],
    mimeType: ['mime_type', nullable(text)],
    statusCode: ['status_code', nullable(integer)],
    transferredBytes: ['transferred_bytes', nullable(integer)],
    durationMs: ['duration_ms', nullable(finite)],
    thirdParty: ['third_party', boolean],
    renderBlocking: ['render_blocking', boolean],
  });

export function parseDashboard(body: string): SiteTrackerDashboardResult {
  const document = jsonDocument(body);
  const result = object(document.data, {
    site: [
      'site',
      (value) => object(value, { groupId: ['group_id', identifier], name: ['name', text] }),
    ],
    scope: [
      'scope',
      (value) =>
        object(value, {
          device: ['device', identifier],
          page: ['page', nullable(trackedPage)],
          availablePages: ['available_pages', list(trackedPage)],
        }),
    ],
    summary: [
      'summary',
      (value) =>
        object(value, {
          healthScore: ['health_score', nullable(integer)],
          healthScoreDelta: ['health_score_delta', nullable(integer)],
          trackedPages: ['tracked_pages', counter],
          checkedPages: ['checked_pages', counter],
          openIssues: ['open_issues', counter],
          criticalIssues: ['critical_issues', counter],
        }),
    ],
    latestCheck: ['latest_check', nullable(check)],
    links: ['links', links],
    needsAttention: [
      'needs_attention',
      (value) =>
        object(value, { total: ['total', counter], items: ['items', list(attentionItem)] }),
    ],
    issueTrend: ['issue_trend', list(issueTrend)],
    transfer: [
      'transfer',
      (value) =>
        object(value, {
          available: ['available', boolean],
          runId: ['run_id', nullable(identifier)],
          totalBytes: ['total_bytes', nullable(counter)],
          reportedRequests: ['reported_requests', nullable(counter)],
          storedRequests: ['stored_requests', counter],
          truncated: ['truncated', boolean],
          unattributedBytes: ['unattributed_bytes', counter],
          source: ['source', nullable(identifier)],
          resourceEndpoint: ['resource_endpoint', nullable(text)],
          categories: ['categories', list(category)],
        }),
    ],
    resourceChanges: [
      'resource_changes',
      (value) =>
        object(value, {
          available: ['available', boolean],
          items: ['items', list(resourceChange)],
        }),
    ],
    performanceHistory: ['performance_history', list(performance)],
  });
  return Object.freeze({ ...result, generatedAt: timestamp(record(document.meta).generated_at) });
}

export function parseResources(body: string): SiteTrackerResourcesResult {
  const document = jsonDocument(body);
  const result = object(document.data, {
    run: [
      'run',
      (value) =>
        object(value, {
          id: ['id', identifier],
          pageId: ['page_id', nullable(identifier)],
          pageUrl: ['page_url', text],
          finishedAt: ['finished_at', nullable(timestamp)],
        }),
    ],
    type: ['type', identifier],
    device: ['device', identifier],
    summary: [
      'summary',
      (value) =>
        object(value, {
          requests: ['requests', counter],
          transferredBytes: ['transferred_bytes', counter],
          storedRequests: ['stored_requests', counter],
          reportedRequests: ['reported_requests', counter],
          truncated: ['truncated', boolean],
        }),
    ],
    items: ['items', list(resourceItem)],
    pagination: [
      'pagination',
      (value) =>
        object(value, {
          page: ['page', positive],
          perPage: ['per_page', pageSize],
          total: ['total', counter],
          lastPage: ['last_page', positive],
        }),
    ],
  });
  return Object.freeze({ ...result, generatedAt: timestamp(record(document.meta).generated_at) });
}
