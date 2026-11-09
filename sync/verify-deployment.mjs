import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const {endpoint} = JSON.parse(readFileSync(new URL('../app/sync-deployment.json', import.meta.url), 'utf8'));
const origin = 'https://xiaoyecodes.github.io';
const preflight = await fetch(endpoint, {
  method: 'OPTIONS',
  headers: {Origin: origin, 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'authorization,content-type'},
  signal: AbortSignal.timeout(15000)
});
assert.equal(preflight.status, 204, 'Pages should be able to reach the Worker');
assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), origin);
assert(preflight.headers.get('Access-Control-Allow-Methods')?.split(/,\s*/).includes('PUT'));
const probe = await fetch(endpoint, {headers: {Origin: origin}, signal: AbortSignal.timeout(15000)});
assert.equal(probe.status, 401, 'Unauthenticated requests must not read the shared portfolio');
console.log('Verified Pages preflight and unauthenticated access control.');
