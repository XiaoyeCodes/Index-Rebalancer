import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {CHAINS,fileFor} from './assets.mjs';
import {repairQuotes} from './repair-quotes.mjs';
function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rebalance-repair-'));
  t.after(()=>{assert.equal(path.dirname(dir),fs.realpathSync(os.tmpdir()));assert.ok(path.basename(dir).startsWith('rebalance-repair-'));fs.rmSync(dir,{recursive:true,force:true});});
  const url=pathToFileURL(dir+path.sep);
  for(const ticker of ['SPY',...Object.values(CHAINS).map(c=>c.at(-1)).filter(t=>/\.(SS|SZ|HK)$/.test(t))]) {
    const r={meta:{symbol:ticker,exchangeTimezoneName:ticker==='SPY'?'America/New_York':'Asia/Shanghai',instrumentType:'ETF'},timestamp:['2026-11-10','2026-11-11','2026-11-12'].map(d=>Date.parse(d+(ticker==='SPY'?'T14:30Z':'T01:30Z'))/1000),indicators:{quote:[Object.fromEntries(['open','high','low','close'].map(k=>[k,[100,ticker==='512800.SS'?null:101,102]]))],adjclose:[{adjclose:[100,ticker==='512800.SS'?null:101,102]}]}};
    fs.writeFileSync(new URL(fileFor(ticker),url),JSON.stringify({chart:{result:[r]}}));
  }
  return url;
}
const now=Date.parse('2026-11-12T04:00Z');
const request=async url=>url.includes('eastmoney')?{data:{klines:['2026-11-11,101,101,101,101,10']}}:{data:{sh512800:{day:[['2026-11-11','101','101','101','101','10']]}}};
test('a missing closed bar is filled only after two feeds agree and is replayable from dated evidence',async t=>{
  const rawDir=fixture(t),result=await repairQuotes({rawDir,request,now});
  assert.equal(result.evidence.length,1);assert.equal(result.asOf,'2026-11-11');
  let r=JSON.parse(fs.readFileSync(new URL(fileFor('512800.SS'),rawDir))).chart.result[0];
  assert.equal(r.indicators.quote[0].close[1],101);assert.equal(r.indicators.adjclose[0].adjclose[1],101);
  r.indicators.quote[0].close[1]=null;r.indicators.adjclose[0].adjclose[1]=null;delete r.verifiedRepairs;
  fs.writeFileSync(new URL(fileFor('512800.SS'),rawDir),JSON.stringify({chart:{result:[r]}}));
  const repeated=await repairQuotes({rawDir,archive:result.evidence,request:()=>{throw Error('network should not be used');},now});
  assert.equal(repeated.applied.length,1);assert.equal(repeated.evidence.length,1);
});
test('fallback disagreement leaves the original missing bar unfilled',async t=>{
  const rawDir=fixture(t);
  await assert.rejects(repairQuotes({rawDir,now,request:async url=>url.includes('eastmoney')?{data:{klines:['2026-11-11,102,102,102,102,10']}}:request(url)}),/disagreement/);
  const r=JSON.parse(fs.readFileSync(new URL(fileFor('512800.SS'),rawDir))).chart.result[0];
  assert.equal(r.indicators.quote[0].close[1],null);
});
