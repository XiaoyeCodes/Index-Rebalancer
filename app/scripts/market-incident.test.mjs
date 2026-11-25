import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFile,execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {recordMarketEvent} from './market-incident.mjs';

const run=promisify(execFile);
test('independent workers claim one alert, keep retrying and rearm only after a verified recovery',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'market-incident-'));
  t.after(()=>{
    assert.equal(path.dirname(dir),os.tmpdir());
    assert.ok(path.basename(dir).startsWith('market-incident-'));
    fs.rmSync(dir,{recursive:true,force:true});
  });
  const remote=path.join(dir,'remote.git');
  const git=(args,cwd)=>execFileSync('git',args,{cwd,stdio:'pipe',encoding:'utf8'}).trim();
  git(['init','--bare',remote],dir);
  const workers=['data','pages'].map(name=>{
    const cwd=path.join(dir,name);
    git(['init',cwd],dir);
    git(['remote','add','origin',remote],cwd);
    return cwd;
  });
  const record=(event,verified=true)=>recordMarketEvent(event,{cwd:workers[0],verify:async()=>verified,wait:async()=>{}});
  const healthy=(at,checkedAt)=>({stage:'verified',at,checkedAt});
  assert.equal(await record(healthy(10,9)),'healthy');
  const moduleURL=new URL('./market-incident.mjs',import.meta.url);
  const script=`import {recordMarketEvent} from ${JSON.stringify(moduleURL.href)};
    console.log(await recordMarketEvent(JSON.parse(process.env.MARKET_TEST_EVENT),{wait:async()=>{}}));`;
  const failed=(stage,i)=>({stage,at:30+i,started:20+i,owner:'test-'+stage+i});
  const parallel=await Promise.all(workers.map((cwd,i)=>run(process.execPath,['--input-type=module','-e',script],{
    cwd,env:{...process.env,MARKET_TEST_EVENT:JSON.stringify(failed(i?'pages':'data',i))}
  })));
  assert.deepEqual(parallel.map(r=>r.stdout.trim()).sort(),['alert','pending']);
  for(let i=2;i<9;i++)assert.equal(await record(failed('data',i)),'pending');
  assert.equal(await record(healthy(50,9)),'pending','publishing older data cannot clear a data outage');
  assert.equal(await record(healthy(52,51),false),'pending','a failed public check cannot rearm notifications');
  assert.equal(await record(healthy(55,53)),'recovered');
  assert.equal(await record(failed('pages',5)),'superseded','a late result cannot reopen the recovered incident');
  assert.equal(await record(failed('data',70)),'alert');
  assert.equal(await record(failed('pages',71)),'pending');
});
