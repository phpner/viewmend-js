export type SiteTrackerDevice = 'desktop' | 'mobile';
export type SiteTrackerResourceType = 'images' | 'javascript' | 'css' | 'other';

export interface SiteTrackerDashboardOptions {
  /** Omit to let ViewMend select the homepage or first active page. */
  readonly pageId?: string | null;
  readonly device?: SiteTrackerDevice;
  readonly signal?: AbortSignal;
}

export interface SiteTrackerResourcesOptions {
  readonly runId: string;
  readonly type: SiteTrackerResourceType;
  readonly device?: SiteTrackerDevice;
  /** Starts at 1. */
  readonly page?: number;
  /** From 1 to 300; defaults to 50. */
  readonly perPage?: number;
  readonly signal?: AbortSignal;
}

export interface SiteTrackerTrackedPageSummary {
  readonly id: string;
  readonly url: string;
  readonly lastCheckedAt: string | null;
}

export interface SiteTrackerDashboardSite {
  readonly groupId: string;
  readonly name: string;
}

export interface SiteTrackerDashboardScope {
  readonly device: string;
  readonly page: SiteTrackerTrackedPageSummary | null;
  readonly availablePages: readonly SiteTrackerTrackedPageSummary[];
}

export interface SiteTrackerDashboardSummary {
  readonly healthScore: number | null;
  readonly healthScoreDelta: number | null;
  readonly trackedPages: number;
  readonly checkedPages: number;
  readonly openIssues: number;
  readonly criticalIssues: number;
}

export interface SiteTrackerDashboardCheck {
  readonly runId: string;
  readonly status: string;
  readonly finishedAt: string | null;
  readonly hasComparison: boolean;
}

export interface SiteTrackerDashboardLinks {
  readonly issues: string | null;
  readonly issueHistory: string | null;
  readonly resourceHistory: string | null;
  readonly performanceHistory: string | null;
}

export interface SiteTrackerAttentionItem {
  readonly id: string;
  readonly source: string;
  readonly severity: string;
  readonly title: string;
  readonly message: string | null;
  readonly status: string;
  readonly pageId: string;
  readonly pageUrl: string | null;
  readonly occurredAt: string | null;
}

export interface SiteTrackerDashboardAttention {
  readonly total: number;
  readonly items: readonly SiteTrackerAttentionItem[];
}

export interface SiteTrackerIssueTrendPoint {
  readonly runId: string;
  readonly finishedAt: string | null;
  readonly critical: number;
  readonly warning: number;
}

export interface SiteTrackerTransferCategory {
  readonly key: string;
  readonly bytes: number;
  readonly requests: number;
}

export interface SiteTrackerDashboardTransfer {
  readonly available: boolean;
  readonly runId: string | null;
  readonly totalBytes: number | null;
  readonly reportedRequests: number | null;
  readonly storedRequests: number;
  readonly truncated: boolean;
  readonly unattributedBytes: number;
  readonly source: string | null;
  /** Response data only; the SDK never follows this URL automatically. */
  readonly resourceEndpoint: string | null;
  readonly categories: readonly SiteTrackerTransferCategory[];
}

export interface SiteTrackerResourceChange {
  readonly changeType: string;
  readonly resourceType: string;
  readonly url: string;
  readonly mimeType: string | null;
  readonly beforeBytes: number | null;
  readonly afterBytes: number | null;
  readonly deltaBytes: number | null;
  readonly beforeStatus: number | null;
  readonly afterStatus: number | null;
}

export interface SiteTrackerResourceChanges {
  readonly available: boolean;
  readonly items: readonly SiteTrackerResourceChange[];
}

export interface SiteTrackerPerformancePoint {
  readonly runId: string;
  readonly finishedAt: string | null;
  readonly performanceScore: number | null;
  readonly lcpMs: number | null;
  readonly cls: number | null;
  readonly totalBlockingTimeMs: number | null;
}

export interface SiteTrackerDashboardResult {
  readonly site: SiteTrackerDashboardSite;
  readonly scope: SiteTrackerDashboardScope;
  readonly summary: SiteTrackerDashboardSummary;
  readonly latestCheck: SiteTrackerDashboardCheck | null;
  readonly links: SiteTrackerDashboardLinks;
  readonly needsAttention: SiteTrackerDashboardAttention;
  readonly issueTrend: readonly SiteTrackerIssueTrendPoint[];
  readonly transfer: SiteTrackerDashboardTransfer;
  readonly resourceChanges: SiteTrackerResourceChanges;
  readonly performanceHistory: readonly SiteTrackerPerformancePoint[];
  /** Validated RFC 3339 timestamp, preserved without losing fractional precision. */
  readonly generatedAt: string;
}

export interface SiteTrackerResourceRun {
  readonly id: string;
  readonly pageId: string | null;
  readonly pageUrl: string;
  readonly finishedAt: string | null;
}

export interface SiteTrackerResourceSummary {
  readonly requests: number;
  readonly transferredBytes: number;
  readonly storedRequests: number;
  readonly reportedRequests: number;
  readonly truncated: boolean;
}

export interface SiteTrackerResourceItem {
  readonly url: string;
  readonly mimeType: string | null;
  readonly statusCode: number | null;
  readonly transferredBytes: number | null;
  readonly durationMs: number | null;
  readonly thirdParty: boolean;
  readonly renderBlocking: boolean;
}

export interface SiteTrackerPagination {
  readonly page: number;
  readonly perPage: number;
  readonly total: number;
  readonly lastPage: number;
}

export interface SiteTrackerResourcesResult {
  readonly run: SiteTrackerResourceRun;
  readonly type: string;
  readonly device: string;
  readonly summary: SiteTrackerResourceSummary;
  readonly items: readonly SiteTrackerResourceItem[];
  readonly pagination: SiteTrackerPagination;
  readonly generatedAt: string;
}
