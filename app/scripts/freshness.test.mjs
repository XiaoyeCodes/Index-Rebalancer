import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Calendar from '../market-calendar.js';
import {validateSnapshot} from './freshness.mjs';
import {compareCloses} from './crosscheck.mjs';
import {withRollback,targetClosingDate} from './update.mjs';

test('NYSE schedule distinguishes Veterans Day, exchange holidays, weekends and New Year exception',()=>{
  assert.equal(Calendar.session('2026-11-11'),true);
  for(const d of ['2026-11-26','2026-12-25','2027-12-24','2026-04-03','2025-01-09'])assert.equal(Calendar.session(d),false,d);
  assert.equal(Calendar.session('2027-12-31'),true);
  assert.equal(Calendar.expectedUSDate(Date.parse('2026-11-12T03:49Z')),'2026-11-11');
  assert.equal(Calendar.expectedUSDate(Date.parse('2026-11-28T03:49Z')),'2026-11-27');
  assert.equal(Calendar.expectedFXDate(Date.parse('2026-11-12T00:30Z')),'2026-11-10');
  assert.equal(Calendar.expectedFXDate(Date.parse('2026-11-12T01:30Z')),'2026-11-11');
  assert.equal(Calendar.expectedFXDate(Date.parse('2026-11-14T00:30Z')),'2026-11-13');
});
test('a fresh headline cannot conceal a stale individual US asset or a malformed FX history',()=>{
  const d=JSON.parse(fs.readFileSync(new URL('../data/prices-weekly.json',import.meta.url)));
  const now=Date.parse(d.asOf+'T23:59:00Z');
  assert.equal(validateSnapshot(d,null,{now}).problems.length,0);
  d.assets.VOO.asOf='2026-01-01';d.fx.CNY.pop();
  const result=validateSnapshot(d,null,{now});
  assert.ok(result.problems.some(s=>s.includes('VOO')));
  assert.ok(result.problems.some(s=>s.includes('CNY')));
});
test('second-feed checking requires matching dates and refuses price disagreements',()=>{
  assert.equal(compareCloses([{date:'2026-11-11',close:759.8099976}],[{date:'2026-11-11',close:759.81}],.011).length,1);
  assert.throws(()=>compareCloses([{date:'2026-11-11',close:100}],[{date:'2026-11-10',close:100}],.011),/missing/);
  assert.throws(()=>compareCloses([{date:'2026-11-11',close:100}],[{date:'2026-11-11',close:101}],.011),/disagreement/);
});
test('a failed calculation or page build rolls back every publication input byte for byte',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rebalance-atomic-'));
  t.after(()=>{assert.equal(path.dirname(dir),fs.realpathSync(os.tmpdir()));assert.ok(path.basename(dir).startsWith('rebalance-atomic-'));fs.rmSync(dir,{recursive:true,force:true});});
  const a=path.join(dir,'data.json'),b=path.join(dir,'page.html'),c=path.join(dir,'new-report.json');
  fs.writeFileSync(a,'old data');fs.writeFileSync(b,'old page');
  await assert.rejects(withRollback([a,b,c],async()=>{fs.writeFileSync(a,'new data');fs.writeFileSync(b,'new page');fs.writeFileSync(c,'new report');throw Error('build failed');}));
  assert.equal(fs.readFileSync(a,'utf8'),'old data');assert.equal(fs.readFileSync(b,'utf8'),'old page');assert.equal(fs.existsSync(c),false);
});

test('verification follows an already closed available session before the publication grace period, and recovers a missing expected session',()=>{
  const spy={meta:{exchangeTimezoneName:'America/New_York',instrumentType:'ETF'},timestamp:['2026-11-13','2026-11-16'].map(date=>Date.parse(date+'T14:30Z')/1000),indicators:{quote:[{close:[754.37,739.95]}]}};
  assert.equal(targetClosingDate(spy,Date.parse('2026-11-16T20:00Z')),'2026-11-13','unfinished Monday cannot replace Friday');
  assert.equal(Calendar.expectedUSDate(Date.parse('2026-11-16T22:15Z')),'2026-11-13');
  assert.equal(targetClosingDate(spy,Date.parse('2026-11-16T22:15Z')),'2026-11-16','a completed, available Monday can be independently verified');
  spy.timestamp.pop();spy.indicators.quote[0].close.pop();
  assert.equal(targetClosingDate(spy,Date.parse('2026-11-16T23:00Z')),'2026-11-16','missing Monday must be recovered rather than silently publishing Friday');
});
