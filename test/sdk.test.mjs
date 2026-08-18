import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  ViewMend,
  ViewMendAbortError,
  ViewMendAuthenticationError,
  ViewMendAuthorizationError,
  ViewMendConfigurationError,
  ViewMendConflictError,
  ViewMendEndpointDisabledError,
  ViewMendInvalidResponseError,
  ViewMendNetworkError,
  ViewMendNotFoundError,
  ViewMendPayloadTooLargeError,
  ViewMendRateLimitError,
  ViewMendServerError,
  ViewMendTimeoutError,
  ViewMendUnprocessableEventError,
  ViewMendValidationError,
  isKnownQueueStatus,
  siteTrackerEventTypes,
} from '../dist/index.js';

const successBody = {
  delivery_id: 'delivery-123',
  ok: true,
  event_id: 'internal-event-123',
  duplicate: false,
  affected_pages: 2,
  ignored_urls: 1,
  checks_queued: 0,
  queue_status: 'queued',
  scheduled_for: '2026-08-16T12:05:00+00:00',
};

function successResponse(overrides = {}, status = 202, headers = {}) {
  return new Response(JSON.stringify({ ...successBody, ...overrides }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'X-ViewMend-Delivery': 'delivery-123',
      ...headers,
    },
  });
}

function client(fetch, options = {}) {
  return new ViewMend({
    apiToken: 'test-api-token',
    fetch,
    retry: false,
    ...options,
  });
}

describe('Site Tracker contract', () => {
  test('sends the exact v1 request and returns an immutable typed result', async () => {
    const requests = [];
    const viewmend = client(async (url, init) => {
      requests.push({ url, init });
      return successResponse();
    });

    const result = await viewmend.siteTracker('integration/id').events.deployment({
      id: 'deploy-123',
      title: 'Homepage deployed',
      occurredAt: '2026-08-16T12:00:00+00:00',
      siteUrl: 'https://example.com',
      pageUrls: ['https://example.com/', 'https://example.com/pricing'],
      environment: 'production',
      description: 'Published the homepage.',
      referenceUrl: 'https://example.com/releases/123',
      changedFields: ['content', 'metadata'],
      metadata: { commit: 'abc123' },
    });

    assert.equal(requests.length, 1);
    const [{ url, init }] = requests;
    const headers = new Headers(init.headers);
    assert.equal(
      url,
      'https://viewmend.com/api/v1/site-tracker/integrations/integration%2Fid/events',
    );
    assert.equal(init.method, 'POST');
    assert.equal(headers.get('Accept'), 'application/json');
    assert.equal(headers.get('Content-Type'), 'application/json');
    assert.equal(headers.get('Authorization'), 'Bearer test-api-token');
    assert.equal(headers.get('X-ViewMend-SDK'), 'viewmend-js/1.0.0');
    assert.equal(headers.get('User-Agent'), 'viewmend-js/1.0.0');
    assert.equal(headers.has('X-ViewMend-Timestamp'), false);
    assert.deepEqual(JSON.parse(init.body), {
      event_id: 'deploy-123',
      event_type: 'deployment',
      title: 'Homepage deployed',
      occurred_at: '2026-08-16T12:00:00+00:00',
      site_url: 'https://example.com',
      page_urls: ['https://example.com/', 'https://example.com/pricing'],
      environment: 'production',
      description: 'Published the homepage.',
      reference_url: 'https://example.com/releases/123',
      changed_fields: ['content', 'metadata'],
      metadata: { commit: 'abc123' },
    });
    assert.deepEqual(result, {
      deliveryId: 'delivery-123',
      eventId: 'internal-event-123',
      duplicate: false,
      affectedPages: 2,
      ignoredUrls: 1,
      checksQueued: 0,
      queueStatus: 'queued',
      scheduledFor: '2026-08-16T12:05:00+00:00',
    });
    assert.equal(Object.isFrozen(result), true);
  });

  test('maps all semantic helpers to the server event types', async () => {
    const sentTypes = [];
    const events = client(async (_url, init) => {
      sentTypes.push(JSON.parse(init.body).event_type);
      return successResponse();
    }).siteTracker('integration-id').events;

    const methods = [
      'deployment',
      'contentUpdate',
      'pluginUpdate',
      'themeUpdate',
      'cacheCleared',
      'trackingScriptChange',
      'maintenance',
      'custom',
    ];
    for (const method of methods) {
      await events[method]({ id: `event-${method}`, title: 'Change recorded' });
    }

    assert.deepEqual(sentTypes, siteTrackerEventTypes);
  });

  test('omits every optional field from a minimal event', async () => {
    let body;
    const result = await client(async (_url, init) => {
      body = JSON.parse(init.body);
      return successResponse({ scheduled_for: null });
    })
      .siteTracker('integration-id')
      .events.custom({ id: 'custom-1', title: 'Editorial update' });

    assert.deepEqual(body, {
      event_id: 'custom-1',
      event_type: 'custom',
      title: 'Editorial update',
    });
    assert.equal(result.scheduledFor, null);
  });

  test('treats a duplicate as a successful idempotent delivery', async () => {
    const result = await client(async () => successResponse({ duplicate: true }, 200))
      .siteTracker('integration-id')
      .events.deployment({ id: 'stable-deployment-id', title: 'Production deployment' });

    assert.equal(result.duplicate, true);
  });

  test('preserves unknown future queue statuses', async () => {
    const result = await client(async () =>
      successResponse({ queue_status: 'waiting_for_regional_capacity' }),
    )
      .siteTracker('integration-id')
      .events.custom({ id: 'custom-future', title: 'Future status' });

    assert.equal(result.queueStatus, 'waiting_for_regional_capacity');
    assert.equal(isKnownQueueStatus(result.queueStatus), false);
    assert.equal(isKnownQueueStatus('queued'), true);
  });

  test('supports a validated custom API base URL', async () => {
    let requestUrl;
    await client(
      async (url) => {
        requestUrl = url;
        return successResponse();
      },
      { apiBaseUrl: 'https://self-hosted.example/api/v1/' },
    )
      .siteTracker('custom/id')
      .events.custom({ id: 'custom-2', title: 'Custom base' });

    assert.equal(
      requestUrl,
      'https://self-hosted.example/api/v1/site-tracker/integrations/custom%2Fid/events',
    );
  });
});

describe('validation', () => {
  test('rejects invalid client configuration before a request', () => {
    assert.throws(() => new ViewMend({ apiToken: '' }), ViewMendConfigurationError);
    assert.throws(
      () => new ViewMend({ apiToken: 'token', apiBaseUrl: 'https://user@example.com/api' }),
      ViewMendConfigurationError,
    );
    assert.throws(
      () => new ViewMend({ apiToken: 'token', timeoutMs: 0 }),
      ViewMendConfigurationError,
    );
    assert.throws(
      () =>
        new ViewMend({
          apiToken: 'token',
          retry: { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 5 },
        }),
      ViewMendConfigurationError,
    );
  });

  test('rejects invalid integration and required event fields before fetch', async () => {
    let calls = 0;
    const viewmend = client(async () => {
      calls += 1;
      return successResponse();
    });

    assert.throws(() => viewmend.siteTracker('   '), ViewMendValidationError);
    await assert.rejects(
      viewmend.siteTracker('integration').events.custom({ id: '', title: 'Title' }),
      ViewMendValidationError,
    );
    await assert.rejects(
      viewmend.siteTracker('integration').events.custom({ id: 'id', title: ' '.repeat(3) }),
      ViewMendValidationError,
    );
    assert.equal(calls, 0);
  });

  test('validates dates, URLs, array limits, duplicates, and unknown fields', async () => {
    const events = client(async () => successResponse()).siteTracker('integration').events;
    const invalidCases = [
      null,
      { id: 'id', title: 'Title', occurredAt: '2026-08-16' },
      { id: 'id', title: 'Title', occurredAt: new Date(Date.now() + 10 * 60_000) },
      { id: 'id', title: 'Title', siteUrl: 'ftp://example.com' },
      { id: 'id', title: 'Title', pageUrls: Array(21).fill('https://example.com') },
      {
        id: 'id',
        title: 'Title',
        pageUrls: ['https://example.com', 'https://example.com/'],
      },
      { id: 'id', title: 'Title', changedFields: Array(51).fill('content') },
      { id: 'id', title: 'Title', changedFields: ['content', 'content'] },
      { id: 'id', title: 'Title', unsupported: true },
      { id: 'id', title: 'Title', signal: {} },
    ];

    for (const invalid of invalidCases) {
      await assert.rejects(events.custom(invalid), ViewMendValidationError);
    }
  });

  test('requires metadata to be finite, acyclic JSON', async () => {
    const events = client(async () => successResponse()).siteTracker('integration').events;
    const circular = {};
    circular.self = circular;

    await assert.rejects(
      events.custom({ id: 'id', title: 'Title', metadata: { score: Number.NaN } }),
      ViewMendValidationError,
    );
    await assert.rejects(
      events.custom({ id: 'id', title: 'Title', metadata: circular }),
      ViewMendValidationError,
    );
  });

  test('enforces documented string and payload limits before fetch', async () => {
    let calls = 0;
    const events = client(async () => {
      calls += 1;
      return successResponse();
    }).siteTracker('integration').events;
    const invalidCases = [
      { id: 'x'.repeat(161), title: 'Title' },
      { id: 'id', title: 'x'.repeat(141) },
      { id: 'id', title: 'Title', environment: 'x'.repeat(61) },
      { id: 'id', title: 'Title', description: 'x'.repeat(2001) },
      { id: 'id', title: 'Title', referenceUrl: `https://example.com/${'x'.repeat(2030)}` },
      { id: 'id', title: 'Title', changedFields: ['x'.repeat(121)] },
      { id: 'id', title: 'Title', metadata: { value: 'x'.repeat(66_000) } },
    ];

    for (const invalid of invalidCases) {
      await assert.rejects(events.custom(invalid), ViewMendValidationError);
    }
    assert.equal(calls, 0);
  });

  test('accepts exact documented boundaries and serializes Date values', async () => {
    let body;
    await client(async (_url, init) => {
      body = JSON.parse(init.body);
      return successResponse();
    })
      .siteTracker('x'.repeat(255))
      .events.custom({
        id: 'x'.repeat(160),
        title: 'x'.repeat(140),
        occurredAt: new Date('2026-08-16T12:00:00.000Z'),
        pageUrls: Array.from({ length: 20 }, (_, index) => `https://example.com/${index}`),
        environment: 'x'.repeat(60),
        description: 'x'.repeat(2000),
        changedFields: Array.from({ length: 50 }, (_, index) => `field-${index}`),
      });

    assert.equal(body.event_id.length, 160);
    assert.equal(body.page_urls.length, 20);
    assert.equal(body.changed_fields.length, 50);
    assert.equal(body.occurred_at, '2026-08-16T12:00:00.000Z');
  });

  test('snapshots metadata before the request is sent', async () => {
    const metadata = { commit: 'abc123' };
    let body;
    const promise = client(async (_url, init) => {
      body = JSON.parse(init.body);
      return successResponse();
    })
      .siteTracker('integration')
      .events.custom({ id: 'id', title: 'Title', metadata });
    metadata.commit = 'changed-later';
    await promise;

    assert.deepEqual(body.metadata, { commit: 'abc123' });
  });
});

describe('errors and response validation', () => {
  const errorCases = [
    [401, ViewMendAuthenticationError],
    [403, ViewMendAuthorizationError],
    [404, ViewMendNotFoundError],
    [409, ViewMendConflictError],
    [410, ViewMendEndpointDisabledError],
    [413, ViewMendPayloadTooLargeError],
    [500, ViewMendServerError],
  ];

  for (const [status, ErrorClass] of errorCases) {
    test(`maps HTTP ${status} to ${ErrorClass.name}`, async () => {
      await assert.rejects(
        client(
          async () =>
            new Response('{"message":"private server detail"}', {
              status,
              headers: { 'X-ViewMend-Delivery': 'delivery-error' },
            }),
        )
          .siteTracker('integration')
          .events.custom({ id: 'id', title: 'Title' }),
        (error) => {
          assert.equal(error instanceof ErrorClass, true);
          assert.equal(error.statusCode, status);
          assert.equal(error.deliveryId, 'delivery-error');
          assert.doesNotMatch(error.message, /private server detail/);
          return true;
        },
      );
    });
  }

  test('exposes bounded validation field names without raw response details', async () => {
    await assert.rejects(
      client(
        async () =>
          new Response(
            JSON.stringify({
              message: 'private detail',
              errors: { title: ['private title detail'], site_url: ['private URL detail'] },
            }),
            { status: 422, headers: { 'X-ViewMend-Delivery': 'delivery-422' } },
          ),
      )
        .siteTracker('integration')
        .events.custom({ id: 'id', title: 'Title' }),
      (error) => {
        assert.equal(error instanceof ViewMendUnprocessableEventError, true);
        assert.deepEqual(error.fields, ['title', 'site_url']);
        assert.doesNotMatch(JSON.stringify(error), /private/);
        return true;
      },
    );
  });

  test('parses delta-seconds and HTTP-date Retry-After values', async () => {
    const deltaError = await captureError(
      client(async () => new Response('{}', { status: 429, headers: { 'Retry-After': '4' } }))
        .siteTracker('integration')
        .events.custom({ id: 'id', title: 'Title' }),
    );
    assert.equal(deltaError instanceof ViewMendRateLimitError, true);
    assert.equal(deltaError.retryAfterMs, 4000);

    const date = new Date(Date.now() + 5000).toUTCString();
    const dateError = await captureError(
      client(async () => new Response('{}', { status: 429, headers: { 'Retry-After': date } }))
        .siteTracker('integration')
        .events.custom({ id: 'id-2', title: 'Title' }),
    );
    assert.equal(dateError instanceof ViewMendRateLimitError, true);
    assert.ok(dateError.retryAfterMs >= 3000 && dateError.retryAfterMs <= 5000);
  });

  test('rejects malformed and inconsistent success responses', async () => {
    const responses = [
      new Response('{not-json', { status: 202 }),
      successResponse({}, 202, { 'X-ViewMend-Delivery': 'different' }),
      successResponse({ duplicate: true }, 202),
      successResponse({ affected_pages: -1 }),
      successResponse({ scheduled_for: 'not-a-date' }),
      successResponse({ scheduled_for: '2026-08-16' }),
    ];

    for (const response of responses) {
      await assert.rejects(
        client(async () => response)
          .siteTracker('integration')
          .events.custom({ id: 'id', title: 'Title' }),
        ViewMendInvalidResponseError,
      );
    }
  });

  test('does not expose tokens or raw bodies through errors or object serialization', async () => {
    const apiToken = 'sensitive-test-value';
    const viewmend = new ViewMend({
      apiToken,
      retry: false,
      fetch: async () => {
        throw new Error(`Authorization: Bearer ${apiToken}`);
      },
    });
    const error = await captureError(
      viewmend.siteTracker('integration').events.custom({ id: 'id', title: 'Title' }),
    );

    assert.equal(error instanceof ViewMendNetworkError, true);
    assert.doesNotMatch(
      `${String(error)}\n${JSON.stringify(error)}\n${JSON.stringify(viewmend)}`,
      /sensitive-test-value/,
    );
    assert.equal(error.cause, undefined);
  });
});

describe('retries, timeout, and cancellation', () => {
  test('retries network failures with the identical stable payload', async () => {
    const bodies = [];
    let calls = 0;
    const result = await client(
      async (_url, init) => {
        calls += 1;
        bodies.push(init.body);
        if (calls === 1) throw new Error('temporary');
        return successResponse();
      },
      { retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2 } },
    )
      .siteTracker('integration')
      .events.deployment({ id: 'stable-id', title: 'Production deployment' });

    assert.equal(result.duplicate, false);
    assert.equal(calls, 2);
    assert.equal(bodies[0], bodies[1]);
    assert.match(bodies[1], /"event_id":"stable-id"/);
  });

  test('retries a transient failure while reading a successful response body', async () => {
    let calls = 0;
    await client(
      async () => {
        calls += 1;
        if (calls === 1) {
          const response = successResponse();
          response.text = async () => {
            throw new Error('connection reset');
          };
          return response;
        }
        return successResponse();
      },
      { retry: { maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 1 } },
    )
      .siteTracker('integration')
      .events.custom({ id: 'body-retry-id', title: 'Body retry' });

    assert.equal(calls, 2);
  });

  test('retries 429 and selected 5xx responses but not permanent 4xx', async () => {
    for (const status of [429, 500, 502, 503, 504]) {
      let calls = 0;
      await client(
        async () => {
          calls += 1;
          return calls === 1
            ? new Response('{}', { status, headers: { 'Retry-After': '0' } })
            : successResponse();
        },
        { retry: { maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 1 } },
      )
        .siteTracker('integration')
        .events.custom({ id: `id-${status}`, title: 'Retry' });
      assert.equal(calls, 2);
    }

    let permanentCalls = 0;
    await assert.rejects(
      client(
        async () => {
          permanentCalls += 1;
          return new Response('{}', { status: 422 });
        },
        { retry: { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 1 } },
      )
        .siteTracker('integration')
        .events.custom({ id: 'id-422', title: 'No retry' }),
      ViewMendUnprocessableEventError,
    );
    assert.equal(permanentCalls, 1);
  });

  test('honours and bounds Retry-After during a retry', async () => {
    let calls = 0;
    const startedAt = Date.now();
    await client(
      async () => {
        calls += 1;
        return calls === 1
          ? new Response('{}', { status: 429, headers: { 'Retry-After': '10' } })
          : successResponse();
      },
      { retry: { maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 10 } },
    )
      .siteTracker('integration')
      .events.custom({ id: 'retry-after-id', title: 'Retry-After' });

    assert.equal(calls, 2);
    assert.ok(Date.now() - startedAt >= 8);
  });

  test('times out an attempt with AbortController and returns a typed safe error', async () => {
    await assert.rejects(
      client(
        async (_url, init) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener(
              'abort',
              () => reject(new DOMException('Aborted', 'AbortError')),
              { once: true },
            );
          }),
        { timeoutMs: 5 },
      )
        .siteTracker('integration')
        .events.custom({ id: 'timeout-id', title: 'Timeout' }),
      ViewMendTimeoutError,
    );
  });

  test('composes a caller AbortSignal with the timeout and never retries cancellation', async () => {
    let calls = 0;
    const controller = new AbortController();
    const request = client(
      async (_url, init) => {
        calls += 1;
        return new Promise((_resolve, reject) => {
          init.signal.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        });
      },
      { timeoutMs: 1000, retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2 } },
    )
      .siteTracker('integration')
      .events.custom({ id: 'abort-id', title: 'Abort', signal: controller.signal });
    controller.abort();

    await assert.rejects(request, ViewMendAbortError);
    assert.equal(calls, 1);
  });
});

async function captureError(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail('Expected the promise to reject.');
}
