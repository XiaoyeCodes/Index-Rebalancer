import test from 'node:test';
import assert from 'node:assert/strict';
import {backupPlan,matchesDeployment} from './site-freshness.mjs';

const now=Date.parse('2026-11-18T02:13:00Z'),date='2026-11-17',checkedAt='2026-11-18T00:10:00Z';
const snapshot={asOf:date,fxAsOf:{CNY:date,HKD:date},health:{checkedAt}};
const live={asOf:date,checkedAt,dataSha256:'validated'};
const options={now,dataSha256:'validated'};

test('the backup checks the trading date, both FX series and the deployed snapshot separately',()=>{
  assert.equal(backupPlan({...snapshot,asOf:'2026-11-16'},live,options),'update');
  assert.equal(backupPlan({...snapshot,fxAsOf:{CNY:date,HKD:'2026-11-16'}},live,options),'update');
  for(const old of [null,{...live,asOf:'2026-11-16'},{...live,checkedAt:'invalid'},{...live,dataSha256:'wrong'}])
    assert.equal(backupPlan(snapshot,old,options),'deploy');
  assert.equal(backupPlan(snapshot,live,options),'current');
  assert.equal(backupPlan(snapshot,{...live,checkedAt:'2026-11-18T01:20:00Z'},options),'current');
  assert.equal(backupPlan(snapshot,live,{...options,manual:true}),'update');
});

test('website verification checks the exact dataset, build, timestamp and checked-out commit',()=>{
  const target={...live,sourceCommit:'deployed',applicationSha256:'built'};
  assert.ok(matchesDeployment(target,{...target}));
  for(const key of Object.keys(target))assert.equal(matchesDeployment(target,{...target,[key]:'older'}),false);
});
