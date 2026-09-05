export interface CronRequestOptions {
  readonly signal?: AbortSignal;
}

export interface CronRegistrationInput extends CronRequestOptions {
  readonly cron: string;
  readonly timezone: string;
  readonly endpointPath: string;
  readonly enabled?: boolean;
}

export interface CronRegistrationResult {
  readonly id: string;
  readonly connectionId: string;
  readonly domain: string;
  readonly endpointPath: string;
  readonly endpointUrl: string;
  readonly method: 'POST';
  readonly cron: string;
  readonly timezone: string;
  readonly enabled: boolean;
  /** Future server statuses are preserved. */
  readonly status: string;
  readonly verifiedAt: string | null;
  readonly nextRunAt: string | null;
  readonly lastRunAt: string | null;
  readonly consecutiveFailures: number;
  readonly updatedAt: string | null;
}

export type CronCallbackHeaders =
  | Headers
  | Readonly<Record<string, string | readonly string[] | undefined>>;

export interface CronCallback {
  readonly type: 'cron.verification' | 'cron.run';
  readonly runId: string;
  readonly connectionId: string;
  readonly jobId: string;
  readonly scheduledAt: string;
  readonly attempt: number;
  readonly challenge: string | null;
  isVerification(): boolean;
  isRun(): boolean;
  /** JSON body to return with a 2xx status for a verification challenge. */
  verificationResponseBody(): string;
}

export interface CronClient {
  register(input: CronRegistrationInput): Promise<CronRegistrationResult>;
  current(options?: CronRequestOptions): Promise<CronRegistrationResult | null>;
  disable(options?: CronRequestOptions): Promise<void>;
  verifyCallback(headers: CronCallbackHeaders, rawBody: string | Uint8Array): Promise<CronCallback>;
}
