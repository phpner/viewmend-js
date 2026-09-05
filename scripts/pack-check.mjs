import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const temporaryRoot = mkdtempSync(join(tmpdir(), 'viewmend-sdk-pack-'));
const npmEnvironment = {
  ...process.env,
  npm_config_cache: join(temporaryRoot, 'npm-cache'),
};

try {
  const packOutput = execFileSync(
    'npm',
    ['pack', '--json', '--pack-destination', temporaryRoot, '--ignore-scripts'],
    { cwd: projectRoot, encoding: 'utf8', env: npmEnvironment },
  );
  const [pack] = JSON.parse(packOutput);
  assert.ok(pack, 'npm pack did not return package metadata.');
  assert.ok(pack.size < 100_000, `Packed package is too large: ${pack.size} bytes.`);
  // Includes all module declarations and readable source maps; runtime dependencies remain zero.
  assert.ok(
    pack.unpackedSize < 500_000,
    `Unpacked package is too large: ${pack.unpackedSize} bytes.`,
  );

  const paths = pack.files.map((file) => file.path).sort();
  const required = [
    'CHANGELOG.md',
    'LICENSE',
    'README.md',
    'SECURITY.md',
    'dist/index.cjs',
    'dist/index.cjs.map',
    'dist/index.d.cts',
    'dist/index.d.ts',
    'dist/index.js',
    'dist/index.js.map',
    'package.json',
  ];
  assert.deepEqual(paths, required);
  for (const sourceMap of ['dist/index.js.map', 'dist/index.cjs.map']) {
    const map = JSON.parse(readFileSync(join(projectRoot, sourceMap), 'utf8'));
    assert.equal(map.version, 3);
    assert.ok(map.sources.some((source) => source.endsWith('/src/client.ts')));
    assert.ok(map.sources.some((source) => source.endsWith('/src/internal/transport.ts')));
    assert.equal(map.sources.length, map.sourcesContent.length);
  }

  const unfinishedMarkers = [
    ['TO', 'DO'],
    ['FIX', 'ME'],
  ].map((parts) => parts.join(''));
  const forbiddenContent = new RegExp(
    `\\/Users\\/alex|(?:ghp|npm)_[A-Za-z0-9_-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\\b(?:${unfinishedMarkers.join('|')})\\b`,
    'i',
  );
  for (const file of pack.files) {
    const source = join(projectRoot, file.path);
    if (/\.(?:c?js|d\.cts|d\.ts|json|md|map)$/.test(file.path) || file.path === 'LICENSE') {
      assert.doesNotMatch(readFileSync(source, 'utf8'), forbiddenContent, file.path);
    }
  }

  const tarball = join(temporaryRoot, pack.filename);
  const consumer = join(temporaryRoot, 'consumer');
  mkdirSync(consumer);
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball], {
    cwd: consumer,
    stdio: 'pipe',
    env: npmEnvironment,
  });

  writeFileSync(
    join(consumer, 'esm.mjs'),
    `import { ViewMend } from '@viewmend/sdk';
const result = await new ViewMend({
  apiToken: 'esm-test-value',
  retry: false,
  fetch: async () => new Response(JSON.stringify({ delivery_id: 'esm-delivery', ok: true, event_id: 'esm-event', duplicate: false, affected_pages: 0, ignored_urls: 0, checks_queued: 0, queue_status: 'recorded', scheduled_for: null }), { status: 202, headers: { 'X-ViewMend-Delivery': 'esm-delivery' } }),
}).siteTracker('integration').events.custom({ id: 'esm-id', title: 'ESM smoke' });
if (result.deliveryId !== 'esm-delivery') throw new Error('ESM result mismatch');
`,
  );
  writeFileSync(
    join(consumer, 'cjs.cjs'),
    `const { ViewMend } = require('@viewmend/sdk');
(async () => {
  const result = await new ViewMend({
    apiToken: 'cjs-test-value',
    retry: false,
    fetch: async () => new Response(JSON.stringify({ delivery_id: 'cjs-delivery', ok: true, event_id: 'cjs-event', duplicate: false, affected_pages: 0, ignored_urls: 0, checks_queued: 0, queue_status: 'recorded', scheduled_for: null }), { status: 202, headers: { 'X-ViewMend-Delivery': 'cjs-delivery' } }),
  }).siteTracker('integration').events.custom({ id: 'cjs-id', title: 'CJS smoke' });
  if (result.deliveryId !== 'cjs-delivery') throw new Error('CJS result mismatch');
})().catch((error) => { console.error(error); process.exitCode = 1; });
`,
  );
  writeFileSync(
    join(consumer, 'consumer.ts'),
    `import { ViewMend, type SiteTrackerDeliveryResult, type SiteTrackerEventInput } from '@viewmend/sdk';
const input = { id: 'typed-id', title: 'Typed smoke', pageUrls: ['https://example.com/'] } satisfies SiteTrackerEventInput;
const sdk = new ViewMend({ apiToken: 'typed-test-value', fetch: async () => new Response() });
const delivery: Promise<SiteTrackerDeliveryResult> = sdk.siteTracker('integration').events.deployment(input);
void delivery;
const dashboard: Promise<import('@viewmend/sdk').SiteTrackerDashboardResult> = sdk.siteTracker('integration').dashboard({ device: 'mobile' });
const resources: Promise<import('@viewmend/sdk').SiteTrackerResourcesResult> = sdk.siteTracker('integration').resources({ runId: 'run', type: 'images', perPage: 300 });
const registration: Promise<import('@viewmend/sdk').CronRegistrationResult> = sdk.cron().register({ cron: '* * * * *', timezone: 'UTC', endpointPath: '/cron' });
const current: Promise<import('@viewmend/sdk').CronRegistrationResult | null> = sdk.cron().current();
const disabled: Promise<void> = sdk.cron().disable();
const callback: Promise<import('@viewmend/sdk').CronCallback> = sdk.cron().verifyCallback(new Headers(), new Uint8Array());
void [dashboard, resources, registration, current, disabled, callback];
// @ts-expect-error device selection is closed for requests
sdk.siteTracker('integration').dashboard({ device: 'tablet' });
// @ts-expect-error a resource category is required
sdk.siteTracker('integration').resources({ runId: 'run' });
// @ts-expect-error neutral Cron does not accept integration metadata
sdk.cron().register({ cron: '* * * * *', timezone: 'UTC', endpointPath: '/cron', plugin: {} });
dashboard.then((value) => {
  const score: number | null = value.summary.healthScore;
  const date: string = value.generatedAt;
  const pages: readonly import('@viewmend/sdk').SiteTrackerTrackedPageSummary[] = value.scope.availablePages;
  void [score, date, pages];
  // @ts-expect-error nested results are immutable
  value.summary.healthScore = 1;
  // @ts-expect-error collections are immutable
  value.scope.availablePages.push({});
});
`,
  );
  writeFileSync(
    join(consumer, 'consumer.cts'),
    `import { ViewMend, type SiteTrackerEventInput } from '@viewmend/sdk';
const input = { id: 'typed-cjs-id', title: 'Typed CJS smoke' } satisfies SiteTrackerEventInput;
const sdk = new ViewMend({ apiToken: 'typed-cjs-test-value', fetch: async () => new Response() });
void sdk.siteTracker('integration').events.custom(input);
const dashboard: Promise<import('@viewmend/sdk').SiteTrackerDashboardResult> = sdk.siteTracker('integration').dashboard();
const resources: Promise<import('@viewmend/sdk').SiteTrackerResourcesResult> = sdk.siteTracker('integration').resources({ runId: 'run', type: 'css' });
const current: Promise<import('@viewmend/sdk').CronRegistrationResult | null> = sdk.cron().current();
void [dashboard, resources, current];
`,
  );
  writeFileSync(
    join(consumer, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        lib: ['ES2022', 'DOM'],
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        noEmit: true,
        skipLibCheck: false,
      },
      include: ['consumer.ts', 'consumer.cts'],
    }),
  );

  execFileSync(process.execPath, ['esm.mjs'], { cwd: consumer, stdio: 'pipe' });
  execFileSync(process.execPath, ['cjs.cjs'], { cwd: consumer, stdio: 'pipe' });
  const dashboardFixture = readFileSync(
    join(projectRoot, 'test/fixtures/site-tracker-empty-dashboard.json'),
    'utf8',
  );
  const resourcesFixture = readFileSync(
    join(projectRoot, 'test/fixtures/site-tracker-empty-resources.json'),
    'utf8',
  );
  const modulesSmoke = `
(async () => {
  const sdk = new ViewMend({ apiToken: 'module-test-value', retry: false, fetch: async (url, init) => {
    if (url.includes('/dashboard?')) return new Response(JSON.stringify(${dashboardFixture}));
    if (url.includes('/resources?')) return new Response(JSON.stringify(${resourcesFixture}));
    if (init.method === 'DELETE') return new Response(null, { status: 204 });
    return new Response('{"error":{"code":"registration_not_found"}}', { status: 404 });
  } });
  const dashboard = await sdk.siteTracker('integration').dashboard();
  if (dashboard.scope.page !== null || !Object.isFrozen(dashboard.scope)) throw new Error('Dashboard smoke failed');
  const resources = await sdk.siteTracker('integration').resources({ runId: 'run', type: 'other' });
  if (resources.items.length !== 0 || resources.pagination.lastPage !== 1) throw new Error('Resources smoke failed');
  if (await sdk.cron().current() !== null) throw new Error('Cron read smoke failed');
  await sdk.cron().disable();
  const token = 'vmcron1_cronconn_' + 'a'.repeat(26) + '_' + 'b'.repeat(64) + '_' + 'c'.repeat(64);
  if (!Object.isFrozen(CronCallbackVerifier.fromToken(token))) throw new Error('Verifier export smoke failed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
`;
  for (const [name, imports] of [
    ['modules.mjs', "import { ViewMend, CronCallbackVerifier } from '@viewmend/sdk';"],
    ['modules.cjs', "const { ViewMend, CronCallbackVerifier } = require('@viewmend/sdk');"],
  ]) {
    writeFileSync(join(consumer, name), imports + modulesSmoke);
    execFileSync(process.execPath, [name], { cwd: consumer, stdio: 'pipe' });
  }
  const tsc = join(projectRoot, 'node_modules', 'typescript', 'bin', 'tsc');
  execFileSync(process.execPath, [tsc, '--project', 'tsconfig.json'], {
    cwd: consumer,
    stdio: 'pipe',
  });

  console.log(
    `npm package verified: ${pack.filename}, ${pack.size} packed bytes, ${pack.unpackedSize} unpacked bytes, ${pack.entryCount} files.`,
  );
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
