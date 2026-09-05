# ViewMend SDK for JavaScript and TypeScript

The official server-side JavaScript and TypeScript SDK for [ViewMend](https://viewmend.com/), a website quality and operations platform for SEO checks, performance evidence, page review, and change monitoring.

The SDK sends deployment and website-change events, reads [ViewMend Site Tracker](https://viewmend.com/site-tracker) dashboards and resource inventories, and manages Cron schedules with signed callback verification. Use it from Node.js services, Next.js server routes, Vercel Functions, or CI/CD jobs.

This package supports JavaScript website change monitoring, TypeScript deployment monitoring, Node.js Site Tracker integration, and Vercel deployment monitoring without a framework runtime dependency.

## Documentation

- [ViewMend Site Tracker](https://viewmend.com/site-tracker)
- [Events API setup guide](https://viewmend.com/guides/integrations/events-api)
- [All ViewMend integrations](https://viewmend.com/guides/integrations)
- [Dashboard and resource reads](#site-tracker-dashboard-and-resources)
- [Cron schedules and callbacks](#cron-schedules-and-callbacks)
- [SDK issues and feature requests](https://github.com/phpner/viewmend-js/issues)

## Installation

```bash
npm install @viewmend/sdk
```

The package has zero runtime dependencies. It provides ESM and CommonJS entry points plus bundled TypeScript declarations.

## 30-second quick start

Create a custom Events API connection by following the [Events API setup guide](https://viewmend.com/guides/integrations/events-api), then keep the generated token and integration ID in server-side environment variables.

```js
import { ViewMend } from '@viewmend/sdk';

const apiToken = process.env.VIEWMEND_API_TOKEN;
const integrationId = process.env.VIEWMEND_INTEGRATION_ID;
const deploymentId = process.env.VERCEL_DEPLOYMENT_ID;

if (!apiToken || !integrationId || !deploymentId) {
  throw new Error('Missing required ViewMend environment variables.');
}

const viewmend = new ViewMend({
  apiToken,
});

const result = await viewmend
  .siteTracker(integrationId)
  .events.deployment({
    id: deploymentId,
    title: 'Production deployment',
    siteUrl: 'https://example.com',
    pageUrls: ['https://example.com/'],
    environment: 'production',
  });

console.log(result.queueStatus);
```

Use an event `id` that is stable and unique in the originating system. If delivery is uncertain, send the same event again with the same ID. ViewMend returns a successful duplicate result instead of creating a second Site Tracker event.

> [!CAUTION]
> This SDK is for trusted server-side and serverless code. Never put a ViewMend API token in a browser bundle, React Client Component, `NEXT_PUBLIC_*`, `VITE_*`, public source map, or client-visible response. A custom fetch implementation does not make browser token exposure safe.

## Configuration

```ts
const viewmend = new ViewMend({
  apiToken: process.env.VIEWMEND_API_TOKEN!,
  timeoutMs: 10_000,
  retry: {
    maxAttempts: 3,
    baseDelayMs: 250,
    maxDelayMs: 30_000,
  },
});
```

| Option | Default | Meaning |
| --- | --- | --- |
| `apiToken` | required | Site Tracker API token or Cron connection token, depending on the module. These token scopes are separate. |
| `apiBaseUrl` | `https://viewmend.com/api/v1` | Versioned API base. Supports self-hosted and local ViewMend environments. |
| `fetch` | `globalThis.fetch` | Standards-compatible custom fetch implementation. |
| `timeoutMs` | `10000` | Per-attempt timeout, from 1 ms to 5 minutes. |
| `retry` | 3 attempts | Set to `false` to disable retries, or provide bounded retry settings. |

Configuration, event, query, and registration validation happen before the request. Constructing a client or selecting a module performs no I/O. The client has no singleton state and does not modify global fetch, timers, logging, or framework configuration.

## Supported runtimes

| Runtime | Support | Evidence |
| --- | --- | --- |
| Node.js 22 LTS | supported | CI, ESM/CJS consumer install, TypeScript consumer compile |
| Node.js 24 LTS | supported | CI and release runtime |
| Node.js 26 Current | supported | CI matrix |
| Vercel Functions on Node.js 22/24 | supported | Uses the standard fetch APIs available in the supported Node runtimes |
| Next.js Route Handlers with `runtime = 'nodejs'` | supported | Framework-free server import; no Next.js dependency |
| CI/CD jobs on Node.js 22, 24, or 26 | supported | Same Node package and authentication path |

The distribution contains no Node built-in imports and is checked with a browser-platform bundle smoke test. That check is useful protection against accidental Node coupling, but it is not presented as full Cloudflare Workers, Bun, Deno, or Vercel Edge certification. Those runtimes are not currently part of the release matrix.

Node.js 20 and earlier are not supported. Node.js 20 reached end of life before this package's first release.

## Site Tracker dashboard and resources

Available since JavaScript SDK 1.1.0, matching the read contract in PHP SDK 1.3.0. These methods use the same integration ID and Bearer token as events.

```ts
const tracker = viewmend.siteTracker(integrationId);
const dashboard = await tracker.dashboard();
const mobile = await tracker.dashboard({
  pageId: dashboard.scope.availablePages[0]?.id ?? null,
  device: 'mobile',
});

console.log(mobile.summary.healthScore, mobile.needsAttention.items);
```

`dashboard(options?)` makes `GET /site-tracker/integrations/{integration}/dashboard`. Omit `pageId` (or pass `null`) to select the homepage or first active page. A supplied page ID must be a UUID. `device` is `desktop` by default or `mobile`. Both read methods accept an optional `signal: AbortSignal`.

The immutable `SiteTrackerDashboardResult` contains:

| Property | Contents |
| --- | --- |
| `site` | Group ID and name |
| `scope` | Device, nullable selected page, and available active pages |
| `summary` | Health score/delta, page counts, open/critical issue counts |
| `latestCheck` | Nullable run ID, status, finish time, and comparison availability |
| `links` | Nullable workspace paths for issues and issue/resource/performance history |
| `needsAttention` | Total and up to 10 attention items across active pages |
| `issueTrend` | Critical/warning counts for the selected page's recent checks |
| `transfer` | Transfer bytes, categories, stored/reported requests, and truncation |
| `resourceChanges` | Comparison availability and changed resources |
| `performanceHistory` | Performance score, LCP, CLS, and total blocking time |
| `generatedAt` | Server response time |

Page and issue counts cover active pages in the integration's group. Health, the latest check, and histories describe the selected page; `device` selects device-specific evidence. History contains at most 30 finished checks. Attention totals may exceed the number of returned items.

All nested objects and arrays are frozen, with exported TypeScript interfaces. Timestamps are validated RFC 3339 strings that preserve fractional precision. Missing measurements remain `null`; zero remains zero. Server-defined status, severity, source, and change-type values remain open strings.

With no active pages, `scope.page` and `latestCheck` are null, collections are empty, and workspace links normalize to null. An active page without finished checks also has a null `latestCheck`. Check `transfer.available` and `resourceChanges.available` before displaying their evidence.

```ts
if (dashboard.transfer.available && dashboard.transfer.runId) {
  const resources = await tracker.resources({
    runId: dashboard.transfer.runId,
    type: 'javascript',
    device: 'desktop',
    page: 1,
    perPage: 50,
  });
  console.log(resources.items, resources.pagination, resources.summary.truncated);
}
```

`resources(options)` makes `GET /site-tracker/integrations/{integration}/runs/{run}/resources`. `runId` and `type` are required. Type accepts `images`, `javascript`, `css`, or `other`. Defaults are `device: 'desktop'`, `page: 1`, and `perPage: 50`; `perPage` accepts 1–300. Page numbers are positive safe integers.

`SiteTrackerResourcesResult` has `run`, `type`, `device`, `summary`, `items`, `pagination`, and `generatedAt`. Items expose `url`, nullable `mimeType`, `statusCode`, `transferredBytes`, and `durationMs`, plus `thirdParty` and `renderBlocking` booleans. Raw headers, remote IPs, and collector data are excluded.

Each call fetches one page. Compare `pagination.page` with `pagination.lastPage` to fetch more using the same run, type, and device. Empty inventories have `items: []` and `lastPage: 1`; requests beyond the last page can also return an empty list. Summary category counts and bytes cover all stored rows, independently of pagination. Overall `storedRequests`, `reportedRequests`, and `truncated` describe capture completeness; additional pages cannot recover resources that were never stored.

HTTP 404 throws `ViewMendResourceNotFoundError` (also a `ViewMendNotFoundError`), including an out-of-scope page or run. HTTP 422 throws `ViewMendUnprocessableQueryError`; neither becomes an empty result. Malformed successes throw `ViewMendInvalidResponseError` without retrying. Reads share bounded retries, timeouts, and cancellation with events. The SDK constructs URLs from `apiBaseUrl` and never automatically follows response links or `transfer.resourceEndpoint`.

## Cron schedules and callbacks

Available since JavaScript SDK 1.1.0, matching the neutral registration contract in PHP SDK 1.2.0. Create a Cron connection in ViewMend with a name and domain, then store its connection token on the server. Use a separate client from Site Tracker because the tokens have different scopes.

```ts
const cron = new ViewMend({ apiToken: process.env.VIEWMEND_CRON_TOKEN! }).cron();

const registration = await cron.register({
  cron: '*/15 * * * *',
  timezone: 'Europe/London',
  endpointPath: '/cron',
  enabled: true,
});

const current = await cron.current();
// When the user chooses to pause their schedule:
await cron.disable();
```

`register()` sends `PUT /cron/registration`; `current()` sends GET; `disable()` sends DELETE. All use the configured versioned API base. These operations are safe to repeat and use the same bounded retry policy. Every method accepts `signal` in its options object. `enabled` defaults to true.

Register a five-field cron expression, IANA timezone, and absolute callback path. ViewMend validates the schedule and minimum interval, combines the path with the connected domain, and sends POST. The client cannot choose a host, method, headers, or body. New or changed endpoints remain `pending_verification` until verification succeeds. HTTPS is required except for local development on loopback hosts and `host.docker.internal`.

`CronRegistrationResult` exposes `id`, `connectionId`, `domain`, `endpointPath`, `endpointUrl`, `method`, `cron`, `timezone`, `enabled`, `status`, `verifiedAt`, `nextRunAt`, `lastRunAt`, `consecutiveFailures`, and `updatedAt`. Dates are RFC 3339 strings or null. Results are frozen and future statuses are preserved.

ViewMend is the source of truth for saved settings: call `current()` when opening a settings screen and use the result of `register()` immediately after saving. Only `404 registration_not_found` becomes null. Other HTTP/network failures remain errors; keep cached settings marked stale instead of replacing them with defaults. HTTP 401 with `token_scope_invalid` throws `ViewMendTokenScopeError`, a subclass of `ViewMendAuthenticationError`; 410 throws `ViewMendEndpointDisabledError`; 422 throws `ViewMendUnprocessableRegistrationError`. Cron API errors expose a bounded `requestId` when available.

Verify incoming callbacks before executing any scheduled work. This framework-neutral example accepts a standard `Request` and a durable job handler supplied by your application:

```ts
import { ViewMendCallbackVerificationError, type CronCallback } from '@viewmend/sdk';

async function handleCronRequest(
  request: Request,
  executeOnce: (callback: CronCallback) => Promise<void>,
): Promise<Response> {
  if (request.method !== 'POST') return new Response(null, { status: 405 });
  let callback: CronCallback;
  try {
    callback = await cron.verifyCallback(
      request.headers,
      new Uint8Array(await request.arrayBuffer()),
    );
  } catch (error) {
    if (error instanceof ViewMendCallbackVerificationError) {
      return new Response(null, { status: 401 });
    }
    throw error;
  }

  if (callback.isVerification()) {
    return new Response(callback.verificationResponseBody(), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  await executeOnce(callback);
  return new Response(null, { status: 204 });
}
```

`verifyCallback(headers, rawBody)` accepts `Headers` or a record of string/single-value-array headers, plus a raw string or `Uint8Array` body. It verifies HMAC-SHA256 over `timestamp + '.' + rawBody` using Web Crypto, rejects timestamps more than five minutes from the local clock, checks connection and run IDs, and rejects duplicate signing headers and malformed payloads. Do not parse and re-encode JSON before verification. Verification performs no network I/O; it is also available separately through `CronCallbackVerifier.fromToken(token).verify(headers, rawBody)`.

Callbacks expose `type`, `runId`, `connectionId`, `jobId`, `scheduledAt`, `attempt`, and nullable `challenge`, with `isRun()`, `isVerification()`, and `verificationResponseBody()` helpers. Delivery is at least once: persist completed `runId` values and make `executeOnce` prevent duplicate side effects, including concurrent attempts. The same logical run keeps its ID while `attempt` increases. Return 2xx only after successful work; never log tokens, signatures, or signing secrets.

## Site Tracker events

All helpers accept one `SiteTrackerEventInput` object and return a `Promise<SiteTrackerDeliveryResult>`.

| JavaScript helper | API `event_type` | Typical use |
| --- | --- | --- |
| `events.deployment()` | `deployment` | Application or website deployment |
| `events.contentUpdate()` | `content_update` | Published page or editorial change |
| `events.pluginUpdate()` | `plugin_update` | CMS plugin update |
| `events.themeUpdate()` | `theme_update` | CMS theme change |
| `events.cacheCleared()` | `cache_cleared` | Cache purge or rebuild |
| `events.trackingScriptChange()` | `tracking_script_change` | Analytics, consent, or tag change |
| `events.maintenance()` | `maintenance` | Planned maintenance |
| `events.custom()` | `custom` | Other relevant operational context |

The exact input-to-wire mapping is:

| JavaScript field | JSON field | Rule |
| --- | --- | --- |
| `id` | `event_id` | required, non-blank, max 160 characters |
| helper name | `event_type` | one of the eight types above |
| `title` | `title` | required, non-blank, max 140 characters |
| `occurredAt` | `occurred_at` | ISO 8601 string with timezone, or a valid `Date`; no more than 5 minutes in the future |
| `siteUrl` | `site_url` | absolute HTTP(S) URL, max 2048 characters |
| `pageUrls` | `page_urls` | up to 20 unique absolute HTTP(S) URLs |
| `environment` | `environment` | max 60 characters |
| `description` | `description` | max 2000 characters |
| `referenceUrl` | `reference_url` | absolute HTTP(S) URL, max 2048 characters |
| `changedFields` | `changed_fields` | up to 50 unique strings, max 120 characters each |
| `metadata` | `metadata` | JSON object or array; included only when explicitly supplied |

When `siteUrl` is present, the ViewMend API verifies that its host belongs to the target Tracker project. `pageUrls` target specific tracked pages; unmatched URLs are counted in `ignoredUrls`. Without `pageUrls`, the event applies to the project's tracked pages according to server-side project state.

`changedFields` and `metadata` are optional context declared by the integration. They do not prove that a particular page changed and do not force a check.

## Delivery result

```ts
const result = await viewmend.siteTracker(integrationId).events.contentUpdate({
  id: `cms-entry-${entryId}-${revision}`,
  title: 'Pricing page copy published',
  pageUrls: ['https://example.com/pricing'],
  referenceUrl: `https://cms.example/entries/${entryId}`,
});

if (result.duplicate) {
  console.log('ViewMend had already accepted this event.');
}

console.log({
  deliveryId: result.deliveryId,
  eventId: result.eventId,
  affectedPages: result.affectedPages,
  ignoredUrls: result.ignoredUrls,
  checksQueued: result.checksQueued,
  queueStatus: result.queueStatus,
  scheduledFor: result.scheduledFor,
});
```

Newly accepted events return HTTP `202`; an already accepted stable event ID returns HTTP `200` with `duplicate: true`. Both are successful deliveries. Queue status values are forward-compatible strings: use `isKnownQueueStatus()` for display logic, but preserve unknown values.

An accepted event records change context. It does not promise that a check starts immediately. Project settings, affected pages, queue position, and available credits can influence `queueStatus`, `checksQueued`, and `scheduledFor`.

## Deployment example

Use a deployment identifier from the provider as the stable event ID:

```ts
await viewmend.siteTracker(integrationId).events.deployment({
  id: deploymentId,
  title: `Release ${releaseName}`,
  occurredAt: new Date(),
  siteUrl: 'https://example.com',
  pageUrls: [
    'https://example.com/',
    'https://example.com/pricing',
  ],
  environment: 'production',
  referenceUrl: releaseUrl,
});
```

## Next.js server route

Keep the route on the Node.js runtime and keep both environment variables server-only:

```ts
// app/api/viewmend/deployment/route.ts
import { ViewMend } from '@viewmend/sdk';

export const runtime = 'nodejs';

const viewmend = new ViewMend({
  apiToken: process.env.VIEWMEND_API_TOKEN!,
});

export async function POST(request: Request): Promise<Response> {
  const deployment = (await request.json()) as {
    id: string;
    title: string;
  };

  const result = await viewmend
    .siteTracker(process.env.VIEWMEND_INTEGRATION_ID!)
    .events.deployment({
      id: deployment.id,
      title: deployment.title,
      environment: 'production',
      siteUrl: 'https://example.com',
    });

  return Response.json({
    accepted: true,
    duplicate: result.duplicate,
    queueStatus: result.queueStatus,
  });
}
```

Authenticate callers of your route separately. Do not return ViewMend credentials or complete internal errors to the browser.

## Vercel and CI/CD

For Vercel deployment monitoring, store `VIEWMEND_API_TOKEN` and `VIEWMEND_INTEGRATION_ID` as encrypted project environment variables. Run the SDK in a Node.js Function or a protected deployment job, not in client code.

A generic CI script can use provider-supplied stable IDs:

```ts
import { ViewMend } from '@viewmend/sdk';

const sdk = new ViewMend({ apiToken: process.env.VIEWMEND_API_TOKEN! });

await sdk.siteTracker(process.env.VIEWMEND_INTEGRATION_ID!).events.deployment({
  id: process.env.DEPLOYMENT_ID ?? process.env.GITHUB_SHA!,
  title: `Production deployment ${process.env.GITHUB_SHA?.slice(0, 7)}`,
  environment: 'production',
  referenceUrl: process.env.DEPLOYMENT_URL,
});
```

Make the delivery step fail visibly when ViewMend rejects the event. Safe SDK retries cover short transient failures; an outer CI retry must reuse the same stable event ID.

More connection-specific setup is available in the [ViewMend integrations guide](https://viewmend.com/guides/integrations).

## Retries, timeout, and cancellation

Each request attempt has a 10-second timeout by default. The SDK retries only when all of these conditions hold:

- the operation is safe to repeat (an event with its required stable ID, a Site Tracker read, or a Cron registration/current/disable request);
- fewer than `maxAttempts` attempts have been made;
- fetch failed at the network/timeout boundary, or the API returned `429`, `500`, `502`, `503`, or `504`.

The URL, method, serialized body, and event ID are identical across attempts. The SDK does not retry permanent `4xx` responses, malformed successes, or caller cancellation. `Retry-After` supports both delta-seconds and HTTP-date values and is capped by `maxDelayMs`. Redirects are disabled.

Disable retries for latency-sensitive code:

```ts
const viewmend = new ViewMend({
  apiToken,
  retry: false,
});
```

Cancel the active attempt and any retry backoff with an `AbortSignal`:

```ts
const controller = new AbortController();

const delivery = viewmend.siteTracker(integrationId).events.maintenance({
  id: maintenanceId,
  title: 'Database maintenance completed',
  signal: controller.signal,
});

controller.abort();
await delivery;
```

Caller cancellation produces `ViewMendAbortError`; the SDK timeout produces `ViewMendTimeoutError`.

## Typed error handling

Every SDK error extends `ViewMendError`.

```ts
import {
  ViewMendError,
  ViewMendRateLimitError,
  ViewMendUnprocessableEventError,
} from '@viewmend/sdk';

try {
  await viewmend.siteTracker(integrationId).events.custom({
    id: eventId,
    title: 'Editorial workflow completed',
  });
} catch (error) {
  if (error instanceof ViewMendUnprocessableEventError) {
    console.error('Rejected fields:', error.fields);
  } else if (error instanceof ViewMendRateLimitError) {
    console.error('Retry after milliseconds:', error.retryAfterMs);
  } else if (error instanceof ViewMendError) {
    console.error(error.message);
  } else {
    throw error;
  }
}
```

| Error | Condition |
| --- | --- |
| `ViewMendConfigurationError` | invalid token, base URL, timeout, retry settings, or missing fetch |
| `ViewMendValidationError` | invalid event, read query, or Cron options before network I/O |
| `ViewMendAuthenticationError` | HTTP 401 |
| `ViewMendTokenScopeError` | Cron rejects a Site Tracker token with `401 token_scope_invalid`; extends `ViewMendAuthenticationError` |
| `ViewMendAuthorizationError` | HTTP 403 |
| `ViewMendNotFoundError` | HTTP 404 integration/endpoint not found |
| `ViewMendResourceNotFoundError` | HTTP 404 on a Site Tracker read; extends `ViewMendNotFoundError` |
| `ViewMendConflictError` | HTTP 409 resource-state conflict; normal duplicate event IDs use the successful `duplicate` result instead |
| `ViewMendEndpointDisabledError` | HTTP 410 |
| `ViewMendPayloadTooLargeError` | HTTP 413 |
| `ViewMendUnprocessableEventError` | HTTP 422 on event delivery; bounded field names are available in `fields` |
| `ViewMendUnprocessableQueryError` | HTTP 422 on a Site Tracker read |
| `ViewMendUnprocessableRegistrationError` | HTTP 422 on Cron registration |
| `ViewMendCallbackVerificationError` | Invalid Cron connection token, signature, signing headers, timestamp, or callback payload |
| `ViewMendRateLimitError` | exhausted HTTP 429 retries |
| `ViewMendServerError` | exhausted HTTP 5xx retries |
| `ViewMendNetworkError` | exhausted network retries or unreadable response |
| `ViewMendTimeoutError` | exhausted request-attempt timeouts |
| `ViewMendAbortError` | caller cancellation |
| `ViewMendInvalidResponseError` | malformed JSON, inconsistent success fields, or invalid response shape |

Error messages and enumerable properties never contain the Authorization header, API token, raw response body, or transport exception. Delivery IDs and validation field names are length-bounded before exposure.

## Custom fetch

Inject a standards-compatible fetch function for testing, tracing at an approved boundary, or a runtime that supplies fetch through another module:

```ts
const viewmend = new ViewMend({
  apiToken,
  fetch: async (input, init) => {
    // Do not log init.headers: it contains Authorization.
    return fetch(input, init);
  },
});
```

The SDK owns the request method, authentication, JSON headers, timeout signal, retry policy, and body. A custom fetch must respect `init.signal` for reliable timeout and cancellation behavior.

## Privacy and data minimisation

Send only operational context needed to identify the change and affected tracked pages.

- Prefer provider IDs, release URLs, and public page URLs over customer or user data.
- Do not put secrets, credentials, session identifiers, personal data, source code, or complete webhook payloads in `title`, `description`, URLs, `changedFields`, or `metadata`.
- Omit `metadata` when the typed fields already explain the event.
- Review retention and access controls in the ViewMend account used by your team.

The SDK sends no telemetry of its own and has no hidden network calls. Event helpers, dashboard/resources reads, and Cron register/current/disable calls each perform the requested API operation, with bounded retries. Callback verification stays local.

## Upgrade and versioning policy

The package follows semantic versioning.

- Patch releases fix compatible behavior, validation, documentation, or reliability defects.
- Minor releases add backwards-compatible types or API capabilities.
- Major releases may change public methods, supported runtimes, or wire behavior.

Read [CHANGELOG.md](CHANGELOG.md) before upgrading. Pin an appropriate semver range in production and run your event contract tests against the packed package during dependency updates.

## Troubleshooting

### `ViewMendAuthenticationError`

Confirm that `VIEWMEND_API_TOKEN` is the token for the same custom Events API connection as `VIEWMEND_INTEGRATION_ID`. Do not trim, transform, or expose the token.

### `ViewMendNotFoundError`

Check the integration ID and production API base. A disabled connection returns `ViewMendEndpointDisabledError`, not a not-found error.

### `ViewMendUnprocessableEventError`

Inspect the safe `fields` list. Common causes include an unsupported event type, an invalid URL, a `siteUrl` host that does not belong to the Tracker project, or an `occurredAt` value more than five minutes in the future.

### An event was accepted but no check started

Read `queueStatus`, `checksQueued`, and `scheduledFor`. Event acceptance records timeline context; checks depend on integration auto-check settings, affected tracked pages, queue state, and available credits.

### Duplicate delivery

`duplicate: true` is success. It means ViewMend previously accepted the same stable `event_id` for this integration.

### Timeout in a serverless function

Set the SDK timeout lower than the platform's remaining execution time and await the delivery. If the platform supports post-response work, make its lifecycle explicit instead of starting an unobserved promise.

## Development and testing

```bash
npm ci
npm run quality
```

The quality command checks formatting, lint rules, strict TypeScript, ESM/CJS builds, unit and injected-fetch contract tests, retry/timeout/cancellation behavior, a browser-platform bundle smoke, npm tarball contents and size, ESM and CommonJS consumers installed from the tarball, a TypeScript consumer compile, and repository/package secret-content rules.

CI runs supported Node versions independently. The release workflow repeats the quality gates and publishes only from a GitHub Release whose tag is an exact `vMAJOR.MINOR.PATCH` match for `package.json`.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution workflow.

## Security and support

Report vulnerabilities privately according to [SECURITY.md](SECURITY.md). For SDK or ViewMend product support, email [support@viewmend.com](mailto:support@viewmend.com).

## License

The ViewMend SDK for JavaScript and TypeScript is available under the [MIT License](LICENSE).
