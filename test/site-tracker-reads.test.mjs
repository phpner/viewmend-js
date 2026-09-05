import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  ViewMend,
  ViewMendAbortError,
  ViewMendApiError,
  ViewMendAuthenticationError,
  ViewMendEndpointDisabledError,
  ViewMendInvalidResponseError,
  ViewMendNetworkError,
  ViewMendNotFoundError,
  ViewMendRateLimitError,
  ViewMendResourceNotFoundError,
  ViewMendServerError,
  ViewMendTimeoutError,
  ViewMendUnprocessableQueryError,
  ViewMendValidationError,
} from '../dist/index.js';

const fixture = (name) =>
  JSON.parse(
    readFileSync(new URL(`./fixtures/site-tracker-${name}.json`, import.meta.url), 'utf8'),
  );
const response = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers });
const retry = { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0 };
const tracker = (fetch, options = {}, id = 'integration/id') =>
  new ViewMend({ apiToken: 'test-api-token', fetch, retry: false, ...options }).siteTracker(id);
const calls = [
  ['dashboard', (sdk, signal) => sdk.dashboard({ signal }), 'dashboard'],
  [
    'resources',
    (sdk, signal) => sdk.resources({ runId: 'run/id', type: 'images', signal }),
    'resources',
  ],
];

function camel(value) {
  if (Array.isArray(value)) return value.map(camel);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()),
      camel(item),
    ]),
  );
}

function assertFrozen(value) {
  if (typeof value !== 'object' || value === null) return;
  assert.ok(Object.isFrozen(value));
  for (const item of Object.values(value)) assertFrozen(item);
}

test('dashboard sends exact GET query and maps every PHP fixture field', async () => {
  const data = fixture('dashboard');
  const requests = [];
  const sdk = tracker(async (url, init) => {
    requests.push({ url, init });
    return response(data);
  });
  assert.equal(requests.length, 0);
  const result = await sdk.dashboard({ pageId: data.data.scope.page.id, device: 'mobile' });
  assert.deepEqual(result, { ...camel(data.data), generatedAt: data.meta.generated_at });
  assertFrozen(result);
  const [{ url, init }] = requests;
  assert.equal(requests.length, 1);
  assert.equal(
    url,
    `https://viewmend.com/api/v1/site-tracker/integrations/integration%2Fid/dashboard?page_id=${data.data.scope.page.id}&device=mobile`,
  );
  assert.equal(init.method, 'GET');
  assert.equal(Object.hasOwn(init, 'body'), false);
  assert.equal(init.redirect, 'error');
  assert.equal(init.headers.get('Authorization'), 'Bearer test-api-token');
  assert.equal(init.headers.get('Accept'), 'application/json');
  assert.equal(init.headers.has('Content-Type'), false);
});

test('resources maps all values and encodes an opaque run ID with explicit pagination', async () => {
  const data = fixture('resources');
  let requestedUrl;
  const sdk = tracker(
    async (url) => {
      requestedUrl = url;
      return response(data);
    },
    { apiBaseUrl: 'http://localhost:8090/api/v1/' },
  );
  const result = await sdk.resources({
    runId: "run/id?# !'()*",
    type: 'images',
    device: 'mobile',
    page: 2,
    perPage: 2,
  });
  assert.equal(
    requestedUrl,
    'http://localhost:8090/api/v1/site-tracker/integrations/integration%2Fid/runs/run%2Fid%3F%23%20%21%27%28%29%2A/resources?type=images&device=mobile&page=2&per_page=2',
  );
  assert.deepEqual(result, { ...camel(data.data), generatedAt: data.meta.generated_at });
  assertFrozen(result);
  assert.equal(result.generatedAt, '2026-09-04T17:30:00.123456Z');
});

test('empty dashboard normalizes links and keeps missing evidence null', async () => {
  const data = fixture('empty-dashboard');
  const sdk = tracker(async (url) => {
    assert.ok(url.endsWith('/dashboard?device=desktop'));
    return response(data);
  });
  const expected = {
    ...camel(data.data),
    generatedAt: data.meta.generated_at,
    links: { issues: null, issueHistory: null, resourceHistory: null, performanceHistory: null },
  };
  assert.deepEqual(await sdk.dashboard(), expected);
  assert.deepEqual(await sdk.dashboard({ pageId: null }), expected);
});

test('empty resources preserve out-of-range page and default request settings', async () => {
  const data = fixture('empty-resources');
  const result = await tracker(async (url) => {
    assert.ok(url.endsWith('/runs/run/resources?type=other&device=desktop&page=1&per_page=50'));
    return response(data);
  }).resources({ runId: 'run', type: 'other' });
  assert.deepEqual(result, { ...camel(data.data), generatedAt: data.meta.generated_at });
});

test('unknown response fields are ignored and open statuses remain strings', async () => {
  const data = fixture('dashboard');
  data.data.latest_check.status = 'future-status';
  data.data.needs_attention.items[0].severity = 'future-severity';
  data.data.transfer.categories[0].key = 'future-category';
  data.data.resource_changes.items[0].change_type = 'future-change';
  data.data.private = { raw_headers: 'omitted' };
  const result = await tracker(async () => response(data)).dashboard();
  assert.equal(result.latestCheck.status, 'future-status');
  assert.equal(result.needsAttention.items[0].severity, 'future-severity');
  assert.equal(result.transfer.categories[0].key, 'future-category');
  assert.equal(result.resourceChanges.items[0].changeType, 'future-change');
  assert.equal(Object.hasOwn(result, 'private'), false);
});

test('invalid query options fail locally', async () => {
  let count = 0;
  const sdk = tracker(async () => {
    count++;
    throw new Error('Unexpected fetch');
  });
  for (const options of [
    null,
    [],
    '',
    { pageId: '' },
    { pageId: 'bad-id' },
    { device: 'tablet' },
    { device: null },
    { signal: {} },
    { extra: true },
  ]) {
    await assert.rejects(sdk.dashboard(options), ViewMendValidationError);
  }
  for (const options of [
    undefined,
    null,
    [],
    {},
    { runId: '' },
    { runId: '.' },
    { runId: '..' },
    { runId: '\ud800' },
    { runId: 'x'.repeat(256) },
    { type: 'font' },
    { type: null },
    { page: 0 },
    { page: 1.5 },
    { page: Number.MAX_SAFE_INTEGER + 1 },
    { perPage: 0 },
    { perPage: 301 },
    { page: null },
    { perPage: null },
    { device: null },
    { signal: {} },
    { unknown: true },
  ]) {
    const input =
      options === null || options === undefined || Array.isArray(options)
        ? options
        : { runId: 'run', type: 'images', ...options };
    // {} needs to exercise missing required fields separately.
    if (options && Object.keys(options).length === 0 && !Array.isArray(options)) {
      await assert.rejects(sdk.resources({}), ViewMendValidationError);
    } else await assert.rejects(sdk.resources(input), ViewMendValidationError);
  }
  assert.equal(count, 0);
});

for (const [name, call, fixtureName] of calls) {
  test(`${name}: safe GET retries reuse exactly the same request`, async () => {
    const requests = [];
    const result = await call(
      tracker(
        async (url, init) => {
          requests.push({ url, method: init.method, body: init.body });
          if (requests.length === 1) throw new Error('private network detail');
          if (requests.length === 2) return response({}, 429, { 'Retry-After': '0' });
          return response(fixture(fixtureName));
        },
        { retry },
      ),
    );
    assert.ok(result.generatedAt);
    assert.equal(requests.length, 3);
    assert.deepEqual(requests[1], requests[0]);
    assert.deepEqual(requests[2], requests[0]);
  });

  test(`${name}: maps permanent and exhausted transient failures without exposing bodies`, async () => {
    for (const [status, ErrorClass] of [
      [401, ViewMendAuthenticationError],
      [404, ViewMendResourceNotFoundError],
      [410, ViewMendEndpointDisabledError],
      [422, ViewMendUnprocessableQueryError],
      [429, ViewMendRateLimitError],
      [500, ViewMendServerError],
      [502, ViewMendServerError],
      [503, ViewMendServerError],
      [504, ViewMendServerError],
      [501, ViewMendServerError],
      [302, ViewMendApiError],
    ]) {
      let attempts = 0;
      await assert.rejects(
        call(
          tracker(
            async () => {
              attempts++;
              return response(
                { message: 'test-api-token', errors: { 'test-api-token': ['secret'] } },
                status,
              );
            },
            { retry },
          ),
        ),
        (error) => {
          assert.ok(error instanceof ErrorClass);
          if (status === 404) assert.ok(error instanceof ViewMendNotFoundError);
          assert.equal(error.statusCode, status);
          assert.doesNotMatch(`${error.stack}${JSON.stringify(error)}`, /test-api-token|secret/);
          return true;
        },
      );
      assert.equal(attempts, [429, 500, 502, 503, 504].includes(status) ? 3 : 1);
    }
  });

  test(`${name}: rejects malformed success without retrying`, async () => {
    for (const data of [
      null,
      [],
      {},
      { data: [] },
      { data: fixture(fixtureName).data },
      { ...fixture(fixtureName), meta: { generated_at: '2026-02-30T12:00:00Z' } },
      { ...fixture(fixtureName), meta: { generated_at: '2026-09-04T24:00:00Z' } },
    ]) {
      let attempts = 0;
      await assert.rejects(
        call(
          tracker(
            async () => {
              attempts++;
              return response(data);
            },
            { retry },
          ),
        ),
        ViewMendInvalidResponseError,
      );
      assert.equal(attempts, 1);
    }
    await assert.rejects(
      call(tracker(async () => new Response('{broken'))),
      ViewMendInvalidResponseError,
    );
    await assert.rejects(
      call(tracker(async () => response(fixture(fixtureName), 202))),
      ViewMendApiError,
    );
    await assert.rejects(
      call(tracker(async () => new Response('x', { headers: { 'Content-Length': '1048577' } }))),
      ViewMendInvalidResponseError,
    );
  });

  test(`${name}: cancellation, body timeout and body network failure retain shared transport behavior`, async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      call(
        tracker(async () => {
          assert.fail('Fetch after cancellation');
        }),
        controller.signal,
      ),
      ViewMendAbortError,
    );
    let count = 0;
    await assert.rejects(
      call(
        tracker(
          async () => {
            count++;
            return { status: 200, headers: new Headers(), text: () => new Promise(() => {}) };
          },
          { timeoutMs: 10 },
        ),
      ),
      ViewMendTimeoutError,
    );
    assert.equal(count, 1);
    count = 0;
    await call(
      tracker(
        async () => {
          count++;
          if (count === 1)
            return {
              status: 200,
              headers: new Headers(),
              text: async () => {
                throw new Error('private');
              },
            };
          return response(fixture(fixtureName));
        },
        { retry },
      ),
    );
    assert.equal(count, 2);
    await assert.rejects(
      call(
        tracker(async () => {
          throw new Error('private');
        }),
      ),
      ViewMendNetworkError,
    );
  });
}

test('nested response types and RFC 3339 calendar dates are validated', async () => {
  for (const [path, value] of [
    [['scope', 'available_pages'], {}],
    [['scope', 'page', 'id'], ' '],
    [['summary', 'checked_pages'], -1],
    [['summary', 'health_score'], 1.5],
    [['summary', 'tracked_pages'], Number.MAX_SAFE_INTEGER + 1],
    [['summary', 'open_issues'], '3'],
    [['transfer', 'truncated'], 1],
    [['transfer', 'total_bytes'], -1],
    [['needs_attention', 'items', 0, 'message'], {}],
    [['latest_check', 'finished_at'], 'tomorrow'],
    [['latest_check', 'finished_at'], '2026-01-01T12:00:00+24:00'],
    [['latest_check', 'finished_at'], '2026-01-01T12:00:60Z'],
    [['site', 'name'], '\ud800'],
    [['performance_history', 0, 'cls'], '0.03'],
    [['links'], [null]],
  ]) {
    const data = fixture('dashboard');
    const parent = path.slice(0, -1).reduce((value, key) => value[key], data.data);
    parent[path.at(-1)] = value;
    await assert.rejects(
      tracker(async () => response(data)).dashboard(),
      ViewMendInvalidResponseError,
    );
  }
  for (const [key, value] of [
    ['page', 0],
    ['per_page', 301],
    ['total', -1],
    ['last_page', 0],
  ]) {
    const data = fixture('resources');
    data.data.pagination[key] = value;
    await assert.rejects(
      tracker(async () => response(data)).resources({ runId: 'run', type: 'images' }),
      ViewMendInvalidResponseError,
    );
  }
});
