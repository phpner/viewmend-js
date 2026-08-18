import assert from 'node:assert/strict';
import packageJson from '../package.json' with { type: 'json' };

const tag = process.env.RELEASE_TAG ?? '';
assert.match(tag, /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/);
assert.equal(tag, `v${packageJson.version}`);
console.log(`Release ${tag} matches package version ${packageJson.version}.`);
