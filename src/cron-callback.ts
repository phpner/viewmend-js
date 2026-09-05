import type { CronCallback, CronCallbackHeaders } from './cron-types.js';
import { ViewMendCallbackVerificationError } from './errors.js';
import { identifier, jsonDocument, positive, timestamp } from './internal/response.js';

function invalid(): never {
  throw new ViewMendCallbackVerificationError('The Cron callback could not be verified.');
}

function header(headers: CronCallbackHeaders, wanted: string): string {
  if (headers instanceof Headers) {
    const value = headers.get(wanted)?.trim();
    if (!value) invalid();
    return value;
  }
  if (typeof headers !== 'object' || headers === null || Array.isArray(headers)) invalid();
  const matches = Object.entries(headers).filter(
    ([name]) => name.toLowerCase() === wanted.toLowerCase(),
  );
  if (matches.length !== 1) invalid();
  let value = matches[0]?.[1];
  if (Array.isArray(value)) {
    if (value.length !== 1) invalid();
    value = value[0];
  }
  if (typeof value !== 'string' || value.trim() === '') invalid();
  return value.trim();
}

export class CronCallbackVerifier {
  readonly #connectionId: string;
  readonly #signingSecret: string;

  private constructor(connectionId: string, signingSecret: string) {
    this.#connectionId = connectionId;
    this.#signingSecret = signingSecret;
    Object.freeze(this);
  }

  public static fromToken(token: string): CronCallbackVerifier {
    const match =
      typeof token === 'string'
        ? /^vmcron1_(cronconn_[0-9a-z]{26})_([A-Za-z0-9]{64})_([A-Za-z0-9]{64})$/.exec(token)
        : null;
    if (match === null || match[1] === undefined || match[3] === undefined) {
      throw new ViewMendCallbackVerificationError('The Cron connection token is invalid.');
    }
    return new CronCallbackVerifier(match[1], match[3]);
  }

  public async verify(
    headers: CronCallbackHeaders,
    rawBody: string | Uint8Array,
  ): Promise<CronCallback> {
    try {
      return await this.#verify(headers, rawBody);
    } catch {
      // Neither JSON parse errors nor crypto failures may expose signed data or secrets.
      invalid();
    }
  }

  async #verify(headers: CronCallbackHeaders, rawBody: string | Uint8Array): Promise<CronCallback> {
    const requestId = header(headers, 'X-ViewMend-Request-Id');
    const sentAt = header(headers, 'X-ViewMend-Timestamp');
    const signature = header(headers, 'X-ViewMend-Signature');
    if (
      !/^run_[0-9a-z]{26}$/.test(requestId) ||
      !/^[0-9]{10,12}$/.test(sentAt) ||
      !/^v1=[a-f0-9]{64}$/.test(signature)
    )
      invalid();
    if (Math.abs(Math.floor(Date.now() / 1000) - Number(sentAt)) > 300) invalid();
    const encoder = new TextEncoder();
    if (typeof rawBody !== 'string' && !(rawBody instanceof Uint8Array)) invalid();
    // Copy caller-owned bytes before the first await; verification and parsing use the same snapshot.
    const bytes = typeof rawBody === 'string' ? encoder.encode(rawBody) : new Uint8Array(rawBody);
    if (bytes.length > 1_048_576) invalid();
    const prefix = encoder.encode(`${sentAt}.`);
    const signed = new Uint8Array(prefix.length + bytes.length);
    signed.set(prefix);
    signed.set(bytes, prefix.length);
    const signatureBytes = Uint8Array.from(signature.slice(3).match(/../g) ?? [], (hex) =>
      Number.parseInt(hex, 16),
    );
    const key = await globalThis.crypto.subtle.importKey(
      'raw',
      encoder.encode(this.#signingSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    if (!(await globalThis.crypto.subtle.verify('HMAC', key, signatureBytes, signed))) invalid();
    const data = jsonDocument(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    const type = data.type;
    const runId = identifier(data.run_id);
    const connectionId = identifier(data.connection_id);
    const jobId = identifier(data.job_id);
    const scheduledAt = timestamp(data.scheduled_at);
    const attempt = positive(data.attempt);
    if (
      (type !== 'cron.verification' && type !== 'cron.run') ||
      runId !== requestId ||
      connectionId !== this.#connectionId ||
      !/^cron_[0-9a-z]{26}$/.test(jobId)
    )
      invalid();
    let challenge: string | null = null;
    if (type === 'cron.verification') {
      if (typeof data.challenge !== 'string' || !/^[A-Za-z0-9]{64}$/.test(data.challenge))
        invalid();
      challenge = data.challenge;
    } else if (Object.hasOwn(data, 'challenge')) invalid();
    return Object.freeze({
      type,
      runId,
      connectionId,
      jobId,
      scheduledAt,
      attempt,
      challenge,
      isVerification: () => type === 'cron.verification',
      isRun: () => type === 'cron.run',
      verificationResponseBody: () => {
        if (type !== 'cron.verification' || challenge === null) {
          throw new ViewMendCallbackVerificationError(
            'Only verification callbacks have a challenge response.',
          );
        }
        return JSON.stringify({ challenge });
      },
    });
  }
}
