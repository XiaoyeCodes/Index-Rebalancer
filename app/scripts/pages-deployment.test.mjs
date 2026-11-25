import test from 'node:test';
import assert from 'node:assert/strict';
import {deployPages} from './pages-deployment.mjs';

function scenario(statuses){
  const requests=[];
  let submissions=0;
  const done=deployPages({submit:async()=>String(++submissions),readStatus:async id=>{
    requests.push(id);
    const status=statuses.shift();
    if(status instanceof Error)throw status;
    return status;
  },wait:async()=>{},log:()=>{}});
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
