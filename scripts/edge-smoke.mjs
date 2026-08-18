import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const bundleUrl = new URL('../.tmp/edge/edge-consumer.js', import.meta.url);
const bundle = await readFile(bundleUrl, 'utf8');
assert.doesNotMatch(
  bundle,
  /(?:from|require\s*\()\s*["'](?:node:|fs|path|http|https|stream|crypto)/,
);

const { runEdgeSmoke } = await import(bundleUrl.href);
assert.equal(await runEdgeSmoke(), 'edge-delivery');
console.log(`Edge bundle smoke passed (${Buffer.byteLength(bundle)} bytes).`);
