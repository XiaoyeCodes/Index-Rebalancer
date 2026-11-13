import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {CHAINS,fileFor} from './assets.mjs';
import {auditHistory} from './audit-history.mjs';

const data={asOf:'2026-11-12',dates:['2026-11-10','2026-11-11','2026-11-12']};
const prices=[533.1599731445312,521.1300048828125,523];
const response=symbol=>({data:{symbol,totalRecords:3,tradesTable:{rows:[
  {date:'11/12/2026',close:'$523.00'},
  {date:'11/11/2026',close:'$521.13'},
  {date:'11/10/2026',close:'$533.16'},
]}}});
function fixture(t) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'rebalance-history-retry-'));
  t.after(()=>{
    assert.equal(path.dirname(directory),fs.realpathSync(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('rebalance-history-retry-'));
    fs.rmSync(directory,{recursive:true,force:true});
  });
  for(const chain of Object.values(CHAINS).filter(c=>!/\.(SS|SZ|HK)$/.test(c.at(-1)))) {
    const ticker=chain.at(-1);
    const raw={meta:{symbol:ticker,exchangeTimezoneName:'America/New_York'},
      timestamp:data.dates.map(date=>Date.parse(date+'T14:30Z')/1000),
      indicators:{quote:[{close:prices}]}};
    fs.writeFileSync(path.join(directory,fileFor(ticker)),JSON.stringify({chart:{result:[raw]}}));
  }
  return pathToFileURL(directory+path.sep);
}
async function run(t,mutate) {
  const requests=[],delays=[],rawDir=fixture(t);
  const report=await auditHistory(data,{rawDir,evidence:{records:[]},retryDelays:[10,30],
    now:123456,wait:async delay=>delays.push(delay),log:()=>{},request:async(url,options)=>{
      const symbol=decodeURIComponent(new URL(url).pathname.split('/')[3]);
      const body=response(symbol);
      if(symbol==='MSFT'){
        requests.push({url:new URL(url),...options});
        mutate(body,requests.length);
      }
      return body;
    }});
  return {report,requests,delays,msft:report.results.find(r=>r.id==='MSFT')};
}

test('a wrong-security history snapshot is discarded and every date is audited again after refresh',async t=>{
  const result=await run(t,(body,attempt)=>{if(attempt===1)body.data.symbol='OTHER';});
  assert.equal(result.report.failures.length,0);
  assert.equal(result.report.unresolvedDisagreements,0);
  assert.equal(result.msft.attempts,2);
  assert.equal(result.msft.compared,3);
  assert.deepEqual(result.delays,[10]);
  for(const request of result.requests){
    assert.equal(request.fresh,true);
    assert.equal(request.url.searchParams.get('limit'),'10000');
    assert.equal(request.url.searchParams.get('fromdate'),'2000-01-01');
    assert.equal(request.url.searchParams.get('todate'),data.asOf);
  }
  assert.notEqual(result.requests[0].url.searchParams.get('_'),result.requests[1].url.searchParams.get('_'));
});

test('the observed MSFT response with unrelated prices is retried without accepting the wrong prices',async t=>{
  const result=await run(t,(body,attempt)=>{
    if(attempt<3)body.data.tradesTable.rows.forEach((row,index)=>row.close=['$68.61','$69.11','$67.93'][index]);
  });
  assert.equal(result.msft.attempts,3);
  assert.equal(result.msft.differences.length,0);
  assert.equal(result.msft.compared,3);
  assert.deepEqual(result.delays,[10,30]);
  assert.equal(result.report.observations,result.report.assets*3);
});

test('truncated, stale and invalid snapshots retry and cannot pass as complete history',async t=>{
  for(const scenario of ['truncated','stale','invalid','duplicate','missing-symbol']) {
    await t.test(scenario,async child=>{
      const result=await run(child,body=>{
        if(scenario==='truncated')body.data.tradesTable.rows.pop();
        if(scenario==='stale'){body.data.tradesTable.rows.shift();body.data.totalRecords=2;}
        if(scenario==='invalid')body.data.tradesTable.rows[0].close='NaN';
        if(scenario==='duplicate')body.data.tradesTable.rows[1].date=body.data.tradesTable.rows[0].date;
        if(scenario==='missing-symbol')delete body.data.symbol;
      });
      assert.equal(result.msft,undefined);
      assert.equal(result.report.failures.length,1);
      assert.equal(result.report.failures[0].id,'MSFT');
      assert.equal(result.requests.length,3);
      assert.deepEqual(result.delays,[10,30]);
    });
  }
});

test('a persistent unexplained price disagreement remains blocking after all retries',async t=>{
  const result=await run(t,body=>{body.data.tradesTable.rows[0].close='$524.00';});
  assert.equal(result.msft.attempts,3);
  assert.equal(result.msft.unresolvedDifferences.length,1);
  assert.equal(result.report.unresolvedDisagreements,1);
  assert.equal(result.msft.unresolvedDifferences[0].nasdaq,524);
  assert.equal(result.requests.length,3);
});

test('network failures already exhausted by requestJSON are not multiplied by semantic retries',async t=>{
  const rawDir=fixture(t);let requests=0;
  const report=await auditHistory(data,{rawDir,evidence:{records:[]},wait:async()=>assert.fail('network retry was already exhausted'),
    request:async url=>{
      const symbol=decodeURIComponent(new URL(url).pathname.split('/')[3]);
      if(symbol==='MSFT'){requests++;throw Error('network retries exhausted');}
      return response(symbol);
    }});
  assert.equal(requests,1);
  assert.deepEqual(report.failures,[{id:'MSFT',error:'network retries exhausted'}]);
});

test('Nasdaq share-class aliases identify the same security without relaxing the price audit',async t=>{
  const report=await auditHistory(data,{rawDir:fixture(t),evidence:{records:[]},retryDelays:[],request:async url=>{
    const symbol=decodeURIComponent(new URL(url).pathname.split('/')[3]);
    return response(symbol==='BRK.B'?'BRK/B':symbol);
  }});
  assert.equal(report.failures.length,0);
  assert.equal(report.unresolvedDisagreements,0);
  assert.equal(report.results.find(r=>r.id==='BRK-B').compared,3);
});
