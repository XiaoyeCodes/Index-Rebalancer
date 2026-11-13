import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {CHAINS,fileFor} from './assets.mjs';
import {auditHistory} from './audit-history.mjs';
import {reconcileRaw,resolutionScale,classifyDisagreement,loadResolutions} from './reconcile-history.mjs';

const record=(extra={})=>({id:'AAA',date:'2020-07-09',currency:'USD',basisThrough:'2026-11-12',action:'correct-primary',originalPrimaryClose:100,originalSecondaryClose:99,acceptedClose:99,...extra});
function raw() {
  return {meta:{symbol:'AAA',currency:'USD',exchangeTimezoneName:'America/New_York'},timestamp:['2020-07-08','2020-07-09','2020-07-10'].map(d=>Date.parse(d+'T13:30Z')/1000),
    indicators:{quote:[{open:[100,100,100],high:[110,110,110],low:[90,90,90],close:[100,100,100]}],adjclose:[{adjclose:[80,80,80]}]}};
}
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`);

test('a reviewed correction changes only close and its matching adjusted close',()=>{
  const input=raw(),output=reconcileRaw(input,[record()]);
  assert.deepEqual(input.indicators.quote[0].close,[100,100,100]);
  assert.deepEqual(output.raw.indicators.quote[0].close,[100,99,100]);
  close(output.raw.indicators.adjclose[0].adjclose[1],79.2);
  for(const field of ['open','high','low'])assert.deepEqual(output.raw.indicators.quote[0][field],input.indicators.quote[0][field]);
  assert.equal(output.checks[0].sourceClose,100);
  assert.equal(output.checks[0].status,'corrected');
});

test('repeat updates preserve the original evidence and do not double-adjust; vendor fixes are accepted',()=>{
  const first=reconcileRaw(raw(),[record()]);
  const second=reconcileRaw(first.raw,[record()]);
  assert.deepEqual(second.raw.indicators,first.raw.indicators);
  assert.equal(second.checks[0].sourceClose,100);
  const fixed=raw();fixed.indicators.quote[0].close[1]=99;fixed.indicators.adjclose[0].adjclose[1]=79.2;
  const accepted=reconcileRaw(fixed,[record()]);
  assert.equal(accepted.checks[0].status,'vendor-correct');
  assert.equal(accepted.checks[0].sourceClose,99);
});

test('new unexplained values or a close outside recorded OHLC require a new review',()=>{
  const unexplained=raw();unexplained.indicators.quote[0].close[1]=100.5;
  assert.throws(()=>reconcileRaw(unexplained,[record()]),/unreviewed Yahoo close/);
  assert.throws(()=>reconcileRaw(raw(),[record({acceptedClose:85})]),/outside the recorded high\/low/);
});

test('a stale flat OHLC bar is replaced only with individually reviewed price fields',()=>{
  const input=raw();for(const k of ['open','high','low','close'])input.indicators.quote[0][k][1]=100;
  const r=record({acceptedFields:{open:100.1,high:100.2,low:98.8,close:99},originalPrimaryFields:{open:100,high:100,low:100,close:100}});
  const output=reconcileRaw(input,[r]);
  assert.deepEqual(Object.fromEntries(['open','high','low','close'].map(k=>[k,output.raw.indicators.quote[0][k][1]])),r.acceptedFields);
  close(output.raw.indicators.adjclose[0].adjclose[1],79.2);
});

test('a vendor correction of close does not prevent repair of a separately reviewed wrong low',()=>{
  const input=raw();input.indicators.quote[0].close[1]=99;input.indicators.adjclose[0].adjclose[1]=79.2;
  const r=record({acceptedFields:{close:99,low:95},originalPrimaryFields:{close:100,low:90}});
  const output=reconcileRaw(input,[r]);
  assert.equal(output.raw.indicators.quote[0].low[1],95);
  assert.equal(output.raw.indicators.adjclose[0].adjclose[1],79.2);
  assert.equal(output.checks[0].sourceClose,99);
});

test('correcting the close before an ex-dividend day preserves the cash distribution in earlier factors',()=>{
  const input=raw();input.indicators.adjclose[0].adjclose=[98,98,100];
  input.events={dividends:{ex:{date:input.timestamp[2],amount:2}}};
  const output=reconcileRaw(input,[record()]);
  close(output.raw.indicators.adjclose[0].adjclose[1],97);
  close(output.raw.indicators.adjclose[0].adjclose[0],100*(1-2/99));
  assert.equal(output.raw.indicators.adjclose[0].adjclose[2],100);
  assert.deepEqual(reconcileRaw(output.raw,[record()]).raw.indicators,output.raw.indicators);
});

test('later effective share splits rescale the reviewed basis, while future announced splits do not',()=>{
  const input=raw();input.timestamp[2]=Date.parse('2027-01-05T14:30Z')/1000;
  for(const field of ['open','high','low','close'])input.indicators.quote[0][field]=input.indicators.quote[0][field].map(v=>v/2);
  input.indicators.adjclose[0].adjclose=[40,40,40];
  input.events={splits:{effective:{date:Date.parse('2027-01-04T14:30Z')/1000,numerator:2,denominator:1},future:{date:Date.parse('2027-02-05T14:30Z')/1000,numerator:3,denominator:1}}};
  assert.equal(resolutionScale(input,record()),.5);
  const result=reconcileRaw(input,[record()]);
  close(result.raw.indicators.quote[0].close[1],49.5);
  close(result.raw.indicators.adjclose[0].adjclose[1],39.6);
});

test('a reviewed comparison exception matches only its exact security, date and observed values',()=>{
  const r=record({action:'retain-primary',acceptedClose:100,originalSecondaryClose:101}),evidence={reviewedAt:'2026-11-12',records:[r]};
  const input={id:'AAA',date:r.date,sourceClose:100,canonicalClose:100,secondaryClose:101,raw:raw(),evidence};
  assert.equal(classifyDisagreement(input).status,'secondary-record-reviewed');
  for(const extra of [{date:'2020-07-10'},{id:'BBB'},{canonicalClose:99},{secondaryClose:102}])assert.equal(classifyDisagreement({...input,...extra}),null);
});

test('the seventeen reviewed records carry two corroborating feeds and explicitly separate nine corrections from eight retained prices',()=>{
  const evidence=loadResolutions();
  assert.equal(evidence.records.length,17);
  assert.equal(evidence.records.filter(r=>r.action==='correct-primary').length,9);
  assert.equal(evidence.records.filter(r=>r.action==='retain-primary').length,8);
  for(const record of evidence.records)assert.ok(record.sources.length>=3);
});

test('a new non-week-end source disagreement remains unresolved and is not hidden by old reviewed cases',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rebalance-review-'));
  t.after(()=>{assert.equal(path.dirname(dir),fs.realpathSync(os.tmpdir()));assert.ok(path.basename(dir).startsWith('rebalance-review-'));fs.rmSync(dir,{recursive:true,force:true});});
  for(const chain of Object.values(CHAINS).filter(c=>!/\.(SS|SZ|HK)$/.test(c.at(-1)))) {
    const symbol=chain.at(-1),input=raw();input.meta.symbol=symbol;
    input.timestamp=['2026-11-09','2026-11-10','2026-11-11'].map(d=>Date.parse(d+'T14:30Z')/1000);
    fs.writeFileSync(path.join(dir,fileFor(symbol)),JSON.stringify({chart:{result:[input]}}));
  }
  const result=await auditHistory({asOf:'2026-11-11',dates:['2026-11-11']},{rawDir:pathToFileURL(dir+path.sep),retryDelays:[],request:async url=>({data:{symbol:decodeURIComponent(new URL(url).pathname.split('/')[3]),totalRecords:3,tradesTable:{rows:['11/11/2026','11/10/2026','11/09/2026'].map(date=>({date,close:url.includes('/quote/GLD/')&&date==='11/09/2026'?'101.00':'100.00'}))}}})});
  assert.equal(result.unresolvedDisagreements,1);
  const gold=result.results.find(r=>r.id==='GLD');
  assert.equal(gold.weeklyDifferences.length,0);
  assert.equal(gold.unresolvedDifferences.length,1);
  assert.equal(gold.unresolvedDifferences[0].resolution,undefined);
});
