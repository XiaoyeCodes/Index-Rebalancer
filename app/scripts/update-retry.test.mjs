import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {runWithRetries,refreshCIWorkspace} from './update-retry.mjs';

test('the whole update retries transient failure and succeeds without needing another scheduled job',async()=>{
  const waits=[],refreshes=[];let calls=0;
  const result=await runWithRetries({attempt:async()=>++calls<3?1:0,wait:async delay=>waits.push(delay),beforeAttempt:async index=>refreshes.push(index),log:()=>{}});
  assert.equal(result.attempts,3);assert.equal(result.failures.length,2);
  assert.deepEqual(waits,[60000,180000]);assert.deepEqual(refreshes,[1,2]);
});

test('a successful first attempt is not rerun and persistent failures are never reported as successful',async()=>{
  const result=await runWithRetries({attempt:async()=>0,wait:async()=>assert.fail('unnecessary wait')});
  assert.equal(result.attempts,1);
  let calls=0;
  await assert.rejects(runWithRetries({attempt:async()=>{calls++;throw Error('sources still disagree');},delays:[1,2],wait:async()=>{},log:()=>{}}),/failed after 3 complete attempts/);
  assert.equal(calls,3);
});

test('a checkout/network refresh failure is also bounded by the same retry budget',async()=>{
  let calls=0,refreshes=0;
  await assert.rejects(runWithRetries({attempt:async()=>{calls++;return 1;},beforeAttempt:async()=>{refreshes++;throw Error('GitHub network unavailable');},delays:[1,2],wait:async()=>{},log:()=>{}}),/GitHub network unavailable/);
  assert.equal(calls,1);assert.equal(refreshes,2);
});

test('only the exact disposable CI workspace may be reset between update attempts',t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'rebalance-ci-retry-'));
  t.after(()=>{assert.equal(path.dirname(directory),fs.realpathSync(os.tmpdir()));assert.ok(path.basename(directory).startsWith('rebalance-ci-retry-'));fs.rmSync(directory,{recursive:true,force:true});});
  const calls=[],run=(binary,args,options)=>calls.push({binary,args,options});
  assert.throws(()=>refreshCIWorkspace({env:{GITHUB_ACTIONS:'false',GITHUB_WORKSPACE:directory},workspace:directory,run}),/restricted/);
  assert.throws(()=>refreshCIWorkspace({env:{GITHUB_ACTIONS:'true',GITHUB_WORKSPACE:os.tmpdir()},workspace:directory,run}),/restricted/);
  assert.equal(calls.length,0);
  refreshCIWorkspace({env:{GITHUB_ACTIONS:'true',GITHUB_WORKSPACE:directory},workspace:directory,run});
  assert.deepEqual(calls.map(call=>call.args),[['fetch','origin','main'],['reset','--hard','FETCH_HEAD']]);
  assert.ok(calls.every(call=>call.options.cwd===directory));
});
