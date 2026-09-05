import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import {
  CronCallbackVerifier,
  ViewMend,
  ViewMendAbortError,
  ViewMendApiError,
  ViewMendAuthenticationError,
  ViewMendCallbackVerificationError,
  ViewMendEndpointDisabledError,
  ViewMendInvalidResponseError,
  ViewMendNotFoundError,
  ViewMendRateLimitError,
  ViewMendServerError,
  ViewMendTokenScopeError,
  ViewMendUnprocessableRegistrationError,
  ViewMendValidationError,
} from '../dist/index.js';

// Synthetic credentials only. Native node:crypto signs independently of the SDK's Web Crypto verifier.
const connectionId = `cronconn_${'a'.repeat(26)}`;
const secret = 's'.repeat(64);
const token = `vmcron1_${connectionId}_${'t'.repeat(64)}_${secret}`;
const jobId = `cron_${'c'.repeat(26)}`;
const runId = `run_${'r'.repeat(26)}`;
const challenge = 'z'.repeat(64);
const input = { cron: '*/15 * * * *', timezone: 'Europe/London', endpointPath: '/cron' };
const wireRegistration = {
  id: jobId,
  connection_id: connectionId,
  domain: 'example.com',
  endpoint_path: '/cron',
  endpoint_url: 'https://example.com/cron',
  method: 'POST',
  schedule: { cron: input.cron, timezone: input.timezone },
  enabled: true,
  status: 'pending_verification',
  verified_at: null,
  next_run_at: null,
  last_run_at: null,
  consecutive_failures: 0,
  updated_at: '2026-08-21T09:00:00+00:00',
};
const registration = (data = {}, status = 200) =>
  new Response(JSON.stringify({ data: { ...wireRegistration, ...data } }), { status });
const cron = (fetch, options = {}) =>
  new ViewMend({ apiToken: token, fetch, retry: false, ...options }).cron();
const retries = { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0 };
const wireCallback = (overrides = {}) => ({
  type: 'cron.run',
  run_id: runId,
  connection_id: connectionId,
  job_id: jobId,
  scheduled_at: '2026-09-05T09:00:00Z',
  attempt: 1,
  ...overrides,
});
function signed(rawBody = JSON.stringify(wireCallback()), seconds = Math.floor(Date.now() / 1000)) {
  const sentAt = String(seconds);
  return {
    rawBody,
    headers: {
      'X-ViewMend-Request-Id': runId,
      'X-ViewMend-Timestamp': sentAt,
      'X-ViewMend-Signature': `v1=${createHmac('sha256', secret).update(`${sentAt}.`).update(rawBody).digest('hex')}`,
    },
  };
}

test('Cron registration uses the neutral PHP contract, exact payload, and immutable result', async () => {
  const requests = [];
  const sdk = cron(
    async (url, init) => {
      requests.push({ url, init });
      return registration({}, 201);
    },
    { apiBaseUrl: 'http://localhost:8090/api/v1' },
  );
  assert.equal(requests.length, 0);
  const result = await sdk.register({
    ...input,
    cron: ` ${input.cron} `,
    timezone: ' Europe/London ',
    endpointPath: ' /cron ',
  });
  assert.deepEqual(result, {
    id: jobId,
    connectionId,
    domain: 'example.com',
    endpointPath: '/cron',
    endpointUrl: 'https://example.com/cron',
    method: 'POST',
    cron: input.cron,
    timezone: input.timezone,
    enabled: true,
    status: 'pending_verification',
    verifiedAt: null,
    nextRunAt: null,
    lastRunAt: null,
    consecutiveFailures: 0,
    updatedAt: '2026-08-21T09:00:00+00:00',
  });
  assert.ok(Object.isFrozen(result));
  assert.equal(requests.length, 1);
  const [{ url, init }] = requests;
  assert.equal(url, 'http://localhost:8090/api/v1/cron/registration');
  assert.equal(init.method, 'PUT');
  assert.equal(init.redirect, 'error');
  assert.equal(init.headers.get('Authorization'), `Bearer ${token}`);
  assert.deepEqual(JSON.parse(init.body), {
    schedule: { cron: input.cron, timezone: input.timezone },
    endpoint_path: '/cron',
    enabled: true,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(sdk)), {});
  assert.equal(JSON.stringify(result).includes(token), false);
});

test('Cron reads saved settings, preserves future statuses, and disables idempotently', async () => {
  const requests = [];
  const sdk = cron(async (_url, init) => {
    requests.push(init);
    return init.method === 'GET'
      ? registration({ enabled: false, status: 'future-status' })
      : new Response(null, { status: 204 });
  });
  const current = await sdk.current();
  assert.equal(current.status, 'future-status');
  assert.equal(current.enabled, false);
  assert.equal(await sdk.disable(), undefined);
  assert.equal(await sdk.disable(), undefined);
  assert.deepEqual(
    requests.map((request) => request.method),
    ['GET', 'DELETE', 'DELETE'],
  );
  assert.ok(
    requests.every(
      (request) => !Object.hasOwn(request, 'body') && !request.headers.has('Content-Type'),
    ),
  );
});

test('only a documented registration_not_found 404 means an absent schedule', async () => {
  const sdk = cron(
    async () => new Response('{"error":{"code":"registration_not_found"}}', { status: 404 }),
  );
  assert.equal(await sdk.current(), null);
  for (const body of ['Not Found', '{}', '{"error":{"code":"different_error"}}', '{"error":[]}']) {
    await assert.rejects(
      cron(async () => new Response(body, { status: 404 })).current(),
      ViewMendNotFoundError,
    );
  }
});

test('Cron registration validates inputs without I/O', async () => {
  let count = 0;
  const sdk = cron(async () => {
    count++;
    assert.fail('Unexpected I/O');
  });
  for (const patch of [
    { cron: '' },
    { cron: 'x'.repeat(101) },
    { timezone: '' },
    { timezone: 'x'.repeat(65) },
    { enabled: null },
    { enabled: 1 },
    { signal: {} },
    { plugin: { id: 'obsolete' } },
  ]) {
    await assert.rejects(sdk.register({ ...input, ...patch }), ViewMendValidationError);
  }
  for (const endpointPath of [
    '',
    'cron',
    '//example.com/cron',
    'https://example.com/cron',
    '/a/../cron',
    '/cron?q=x',
    '/cron#x',
    '/a\\cron',
    '/a\u0000cron',
    `/${'x'.repeat(512)}`,
  ]) {
    await assert.rejects(sdk.register({ ...input, endpointPath }), ViewMendValidationError);
  }
  for (const value of [null, [], 'invalid']) {
    await assert.rejects(sdk.register(value), ViewMendValidationError);
    await assert.rejects(sdk.current(value), ViewMendValidationError);
    await assert.rejects(sdk.disable(value), ViewMendValidationError);
  }
  assert.equal(count, 0);
});

test('Cron response validates callback transport, dates, and nested fields', async () => {
  for (const endpointUrl of [
    'https://example.com/cron',
    'http://localhost/cron',
    'http://dev.localhost/cron',
    'http://127.0.0.2/cron',
    'http://[::1]/cron',
    'http://host.docker.internal:8079/cron',
  ]) {
    assert.equal(
      (await cron(async () => registration({ endpoint_url: endpointUrl })).current()).endpointUrl,
      endpointUrl,
    );
  }
  for (const patch of [
    { endpoint_url: 'http://example.com/cron' },
    { endpoint_url: 'https://user:password@example.com/cron' },
    { endpoint_url: 'invalid' },
    { endpoint_url: 'file:///cron' },
    { method: 'GET' },
    { schedule: [] },
    { enabled: 1 },
    { consecutive_failures: -1 },
    { updated_at: 'tomorrow' },
    { updated_at: '2026-02-30T09:00:00Z' },
  ]) {
    await assert.rejects(
      cron(async () => registration(patch)).current(),
      ViewMendInvalidResponseError,
    );
  }
  await assert.rejects(
    cron(async () => registration({ schedule: null }, 201)).register(input),
    (error) => error instanceof ViewMendInvalidResponseError && error.statusCode === 201,
  );
});

for (const [method, call, success] of [
  ['PUT', (sdk) => sdk.register(input), () => registration({}, 201)],
  ['GET', (sdk) => sdk.current(), () => registration()],
  ['DELETE', (sdk) => sdk.disable(), () => new Response(null, { status: 204 })],
]) {
  test(`Cron ${method}: retries preserve URL, method and serialized payload`, async () => {
    const requests = [];
    await call(
      cron(
        async (url, init) => {
          requests.push({ url, method: init.method, body: init.body });
          if (requests.length === 1) throw new Error('private network failure');
          if (requests.length === 2) return new Response(null, { status: 503 });
          return success();
        },
        { retry: retries },
      ),
    );
    assert.equal(requests.length, 3);
    assert.deepEqual(requests[1], requests[0]);
    assert.deepEqual(requests[2], requests[0]);
    assert.equal(requests[0].method, method);
  });
}

test('Cron failures have scoped error classes and request IDs without leaking server bodies', async () => {
  for (const [status, code, ErrorClass] of [
    [401, 'token_scope_invalid', ViewMendTokenScopeError],
    [401, 'unauthenticated', ViewMendAuthenticationError],
    [410, 'disabled', ViewMendEndpointDisabledError],
    [422, 'invalid', ViewMendUnprocessableRegistrationError],
    [429, 'limited', ViewMendRateLimitError],
    [503, 'failed', ViewMendServerError],
    [403, 'denied', ViewMendApiError],
  ]) {
    await assert.rejects(
      cron(
        async () =>
          new Response(JSON.stringify({ error: { code, message: token } }), {
            status,
            headers: { 'X-Request-Id': 'request-test-id', 'Retry-After': '2' },
          }),
      ).current(),
      (error) => {
        assert.ok(error instanceof ErrorClass);
        assert.equal(error.statusCode, status);
        assert.equal(error.requestId, 'request-test-id');
        assert.equal(error.deliveryId, undefined);
        assert.equal(`${error.stack}${JSON.stringify(error)}`.includes(token), false);
        if (status === 429) assert.equal(error.retryAfterMs, 2000);
        return true;
      },
    );
  }
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    cron(async () => {
      assert.fail('Fetch after abort');
    }).register({ ...input, signal: controller.signal }),
    ViewMendAbortError,
  );
});

test('Cron verifies native HMAC signatures and returns a challenge response without I/O', async () => {
  const sdk = cron(async () => {
    assert.fail('Callback verification must be offline');
  });
  const request = signed(JSON.stringify(wireCallback({ type: 'cron.verification', challenge })));
  const result = await sdk.verifyCallback(new Headers(request.headers), request.rawBody);
  assert.ok(Object.isFrozen(result));
  assert.equal(result.isVerification(), true);
  assert.equal(result.isRun(), false);
  assert.deepEqual(JSON.parse(result.verificationResponseBody()), { challenge });
  assert.equal(result.runId, runId);
  assert.equal(result.connectionId, connectionId);
  assert.equal(result.jobId, jobId);
  assert.equal(result.attempt, 1);
  const run = signed();
  const verifier = CronCallbackVerifier.fromToken(token);
  assert.equal(JSON.stringify(verifier), '{}');
  const verifiedRun = await verifier.verify(run.headers, Buffer.from(run.rawBody));
  assert.equal(verifiedRun.isRun(), true);
  assert.equal(verifiedRun.challenge, null);
  assert.throws(() => verifiedRun.verificationResponseBody(), ViewMendCallbackVerificationError);
});

test('Cron signature verification snapshots raw bytes and preserves exact Unicode/whitespace', async () => {
  const raw = Buffer.from(JSON.stringify(wireCallback({ context: 'Привет 🌍' }), null, 2));
  const request = signed(raw);
  const promise = CronCallbackVerifier.fromToken(token).verify(request.headers, raw);
  raw.fill(0);
  assert.equal((await promise).runId, runId);
  const original = signed(JSON.stringify(wireCallback(), null, 2));
  await assert.rejects(
    CronCallbackVerifier.fromToken(token).verify(
      original.headers,
      JSON.stringify(JSON.parse(original.rawBody)),
    ),
    ViewMendCallbackVerificationError,
  );
});

test('Cron rejects invalid, duplicate, mismatched and stale signing headers', async (t) => {
  const now = 1_788_600_000;
  t.mock.method(Date, 'now', () => now * 1000);
  const verifier = CronCallbackVerifier.fromToken(token);
  for (const age of [-300, 0, 300]) {
    const request = signed(undefined, now + age);
    assert.equal((await verifier.verify(request.headers, request.rawBody)).runId, runId);
  }
  for (const age of [-301, 301]) {
    const request = signed(undefined, now + age);
    await assert.rejects(
      verifier.verify(request.headers, request.rawBody),
      ViewMendCallbackVerificationError,
    );
  }
  for (const patch of [
    { 'X-ViewMend-Signature': undefined },
    { 'X-ViewMend-Timestamp': 'invalid' },
    { 'X-ViewMend-Signature': `v1=${'0'.repeat(64)}` },
    { 'X-ViewMend-Request-Id': `run_${'q'.repeat(26)}` },
    { 'x-viewmend-signature': 'duplicate' },
    { 'x-viewmend-request-id': runId },
    { 'x-viewmend-timestamp': String(now) },
    { 'X-ViewMend-Signature': ['first', 'second'] },
  ]) {
    const request = signed(undefined, now);
    await assert.rejects(
      verifier.verify({ ...request.headers, ...patch }, request.rawBody),
      ViewMendCallbackVerificationError,
    );
  }
  const request = signed(undefined, now);
  const headers = Object.fromEntries(
    Object.entries(request.headers).map(([key, value]) => [key.toLowerCase(), [value]]),
  );
  assert.equal((await verifier.verify(headers, request.rawBody)).runId, runId);
});

test('Cron rejects signed malformed payloads and wrong connection tokens without secret disclosure', async () => {
  const verifier = CronCallbackVerifier.fromToken(token);
  for (const patch of [
    { type: 'unknown' },
    { run_id: `run_${'q'.repeat(26)}` },
    { connection_id: `cronconn_${'b'.repeat(26)}` },
    { job_id: 'invalid' },
    { attempt: 0 },
    { attempt: 1.5 },
    { scheduled_at: 'tomorrow' },
    { challenge },
    { type: 'cron.verification' },
    { type: 'cron.verification', challenge: 'invalid' },
  ]) {
    const request = signed(JSON.stringify(wireCallback(patch)));
    await assert.rejects(
      verifier.verify(request.headers, request.rawBody),
      ViewMendCallbackVerificationError,
    );
  }
  for (const rawBody of ['{}', '[]', 'null', '{broken', token]) {
    const request = signed(rawBody);
    await assert.rejects(verifier.verify(request.headers, request.rawBody), (error) => {
      assert.ok(error instanceof ViewMendCallbackVerificationError);
      assert.equal(`${error.stack}${JSON.stringify(error)}`.includes(token), false);
      return true;
    });
  }
  for (const value of ['', 'vmt_site_tracker_value', token.slice(0, -1), `${token}\n`]) {
    assert.throws(() => CronCallbackVerifier.fromToken(value), ViewMendCallbackVerificationError);
  }
});
