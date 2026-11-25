import test from 'node:test';
import assert from 'node:assert/strict';
import {deployPages} from './pages-deployment.mjs';

function scenario(statuses,isPublished){
  const requests=[];
  let submissions=0,elapsed=0;
  const done=deployPages({submit:async()=>String(++submissions),readStatus:async id=>{
    requests.push(id);
    const status=statuses.shift();
    if(status instanceof Error)throw status;
    return status;
  },isPublished,wait:async ms=>{elapsed+=ms;},now:()=>elapsed,log:()=>{}});
  return {requests,done};
}

test('a transient Pages deployment failure retries the artifact, and status read errors only retry the poll',async()=>{
  const run=scenario(['deployment_failed',Object.assign(Error('503'),{status:503}),'in_progress','succeed']);
  await run.done;
  assert.deepEqual(run.requests,['1','2','2','2']);
});

test('invalid content fails immediately and repeated platform failures stop after three submissions',async()=>{
  for(const statuses of [['deployment_content_failed'],Array(3).fill('deployment_failed')]){
    const count=statuses.length,run=scenario(statuses);
    await assert.rejects(run.done,/Pages reported/);
    assert.equal(run.requests.length,count);
  }
});

test('a long Pages queue is polled without submitting a duplicate artifact',async()=>{
  const run=scenario([...Array(65).fill('deployment_queued'),'succeed']);
  await run.done;
  assert.deepEqual([...new Set(run.requests)],['1']);
  const stuck=scenario(Array(100).fill('deployment_queued'));
  await assert.rejects(stuck.done,/15 minutes.*deployment_queued/);
  assert.deepEqual([...new Set(stuck.requests)],['1']);
});

test('the verified public artifact can confirm completion while Pages still reports queued',async()=>{
  let checks=0;
  const run=scenario(Array(90).fill('deployment_queued'),async()=>{
    if(++checks===1)throw Error('connection reset');
    return checks===3;
  });
  await run.done;
  assert.equal(checks,3);
  assert.deepEqual([...new Set(run.requests)],['1']);
});
