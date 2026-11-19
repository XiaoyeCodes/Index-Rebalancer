import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const {endpoint} = JSON.parse(readFileSync(new URL('../app/sync-deployment.json', import.meta.url), 'utf8'));
const origin = 'https://xiaoyecodes.github.io';
const clockURL=new URL('/market-update-status',endpoint);
const status=await fetch(clockURL,{signal:AbortSignal.timeout(15000)});
assert.equal(status.status,200);
assert.ok(typeof (await status.json()).outcome==='string');
assert.equal((await fetch(clockURL,{method:'POST',signal:AbortSignal.timeout(15000)})).status,405);
const preflight = await fetch(endpoint, {
  method: 'OPTIONS',
  headers: {Origin: origin, 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'authorization,content-type'},
  signal: AbortSignal.timeout(15000)
});
assert.equal(preflight.status, 204, 'Pages should be able to reach the Worker');
assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), origin);
assert(preflight.headers.get('Access-Control-Allow-Methods')?.split(/,\s*/).includes('PUT'));
assert(preflight.headers.get('Access-Control-Allow-Methods')?.split(/,\s*/).includes('POST'));
const probe = await fetch(endpoint, {headers: {Origin: origin}, signal: AbortSignal.timeout(15000)});
assert.equal(probe.status, 401, 'Unauthenticated requests must not read the shared portfolio');
for(const method of ['GET','POST']) {
  const response=await fetch(endpoint+'/backups',{method,headers:{Origin:origin},signal:AbortSignal.timeout(15000)});
  assert.equal(response.status,401,'Unauthenticated users must not list or create investment backups');
}
for(const path of ['/auth/resume','/auth/history']) {
  const response=await fetch(new URL(path,endpoint),{headers:{Origin:origin},signal:AbortSignal.timeout(15000)});
  assert.equal(response.status,401,'Unauthenticated users must not resume or read login history');
}
const login=await fetch(new URL('/auth/login',endpoint),{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST'},signal:AbortSignal.timeout(15000)});
assert.equal(login.status,204,'Pages should be able to reach the login service');
console.log('Verified Pages preflight and workspace, backup, and login-history access control.');
