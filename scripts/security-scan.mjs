import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const output = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
  encoding: 'utf8',
});
const files = output.trim().split('\n').filter(Boolean);
const unfinishedMarkers = [
  ['TO', 'DO'],
  ['FIX', 'ME'],
].map((parts) => parts.join(''));
const forbidden = [
  ['local path', /\/Users\/alex/],
  ['unfinished marker', new RegExp(`\\b(?:${unfinishedMarkers.join('|')})\\b`)],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9_-]{20,}\b/],
  ['npm token', /\bnpm_[A-Za-z0-9_-]{20,}\b/],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
];

for (const file of files) {
  if (/\.(?:png|jpe?g|gif|webp|tgz|lock)$/i.test(file)) continue;
  const content = readFileSync(file, 'utf8');
  for (const [label, pattern] of forbidden) {
    assert.doesNotMatch(content, pattern, `${label} found in ${file}`);
  }
}

console.log(`Security content scan passed for ${files.length} repository files.`);
