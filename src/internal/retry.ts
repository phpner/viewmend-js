import { ViewMendAbortError } from '../errors.js';

export const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504]);

export function exponentialDelay(
  attemptsMade: number,
  baseDelayMs: number,
  maxDelayMs: number,
): number {
  return Math.min(maxDelayMs, baseDelayMs * 2 ** Math.max(0, attemptsMade - 1));
}

export function parseRetryAfter(value: string | null, nowMs = Date.now()): number | undefined {
  if (value === null) {
    return undefined;
  }
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const milliseconds = Number(trimmed) * 1000;
    return Number.isFinite(milliseconds) ? milliseconds : undefined;
  }
  const timestamp = Date.parse(trimmed);
  if (!Number.isFinite(timestamp)) {
    return undefined;
  }
  return Math.max(0, timestamp - nowMs);
}

export async function waitForRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    throw new ViewMendAbortError('The ViewMend request was cancelled.');
  }
  if (delayMs === 0) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const done = (): void => {
      signal?.removeEventListener('abort', abort);
      resolve();
    };
    const timer = setTimeout(done, delayMs);
    const abort = (): void => {
      clearTimeout(timer);
      reject(new ViewMendAbortError('The ViewMend request was cancelled.'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}
