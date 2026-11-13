import test from 'node:test';
import assert from 'node:assert/strict';
import {compareCloses,verifySecondaryCloses,requestJSON} from './crosscheck.mjs';

const primary = [
  {date:'2026-11-10',close:749.9199829},
  {date:'2026-11-11',close:759.8099976},
  {date:'2026-11-12',close:757.1199951},
];
const secondary = primary.map(p=>({date:p.date,close:+p.close.toFixed(2)}));
const url='https://api.nasdaq.com/api/quote/SPY/historical?assetclass=etf&limit=10&fromdate=2026-11-10&todate=2026-11-12';
const setup = options => ({primary,url,parse:response=>response.rows,tolerance:.011,
  retryDelays:[10000,30000],now:Date.parse('2026-11-13T02:41:00Z'),log:()=>{},...options});

test('a successful but stale response is retried with fresh requests until every original date matches',async()=>{
  const requests=[],delays=[],before=JSON.stringify(primary);
  const result=await verifySecondaryCloses(setup({
    request:async(requestUrl,options)=>{requests.push({url:new URL(requestUrl),...options});return {rows:requests.length<3?secondary.slice(0,2):secondary};},
    wait:async ms=>delays.push(ms),
  }));
  assert.equal(result.attempts,3);
  assert.equal(result.observations.length,3);
  assert.deepEqual(result.observations.map(row=>row.date),primary.map(row=>row.date));
  assert.deepEqual(delays,[10000,30000]);
  assert.deepEqual(requests.map(r=>r.fresh),[false,true,true]);
  assert.equal(requests[0].url.searchParams.has('_'),false);
  assert.notEqual(requests[1].url.searchParams.get('_'),requests[2].url.searchParams.get('_'));
  for(const request of requests){
    assert.equal(request.url.searchParams.get('fromdate'),'2026-11-10');
    assert.equal(request.url.searchParams.get('todate'),'2026-11-12');
    assert.equal(request.url.searchParams.get('assetclass'),'etf');
  }
  assert.equal(result.url,requests.at(-1).url.href);
  assert.equal(JSON.stringify(primary),before);
});

test('persistent missing dates exhaust the bounded retries and never pass with only older overlapping dates',async()=>{
  let calls=0;const delays=[];
  await assert.rejects(verifySecondaryCloses(setup({
    request:async()=>{calls++;return {rows:secondary.slice(0,2)};},wait:async ms=>delays.push(ms),
  })),error=>error.code==='MISSING_SECONDARY_CLOSE'&&error.message.includes('2026-11-12')&&error.message.includes('latest available: 2026-11-11'));
  assert.equal(calls,3);
  assert.deepEqual(delays,[10000,30000]);
});

test('conflicting prices stop immediately, including when the same response is also missing another date',async()=>{
  for(const partial of [false,true]){
    let calls=0,waits=0;
    const rows=secondary.map((row,i)=>({...row,close:row.close+(i===0?1:0)}));
    await assert.rejects(verifySecondaryCloses(setup({
      request:async()=>{calls++;return {rows:partial?rows.slice(0,2):rows};},wait:async()=>{waits++;},
    })),/closing-price disagreement/);
    assert.equal(calls,1);assert.equal(waits,0);
  }
});

test('invalid prices cannot satisfy price tolerance or be hidden by a missing-date retry',()=>{
  for(const price of [NaN,Infinity,0,-1]){
    assert.throws(()=>compareCloses(primary,[{...secondary[0],close:price},secondary[1]],.011),/invalid closing price/);
    assert.throws(()=>compareCloses([{...primary[0],close:price}],secondary,.011),/invalid closing price/);
  }
});

test('complete data needs only one request; missing primary dates and request errors are not semantic retries',async()=>{
  let calls=0;
  const result=await verifySecondaryCloses(setup({request:async()=>{calls++;return {rows:secondary};},wait:async()=>assert.fail('unnecessary retry')}));
  assert.equal(calls,1);assert.equal(result.attempts,1);
  await assert.rejects(verifySecondaryCloses(setup({primary:[],request:async()=>assert.fail('request without primary dates')})),/missing primary/);
  await assert.rejects(verifySecondaryCloses(setup({request:async()=>{throw Error('network failed');},wait:async()=>assert.fail('requestJSON already handles network retries')})),/network failed/);
});

test('TLS and invalid-JSON failures get bounded network backoff and fresh retry headers',async()=>{
  const calls=[],delays=[];
  const result=await requestJSON('https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=1.512050',{
    run:async(binary,args)=>{
      calls.push({binary,args});
      if(calls.length===1)throw Error('OpenSSL SSL_read: unexpected eof while reading');
      return {stdout:calls.length===2?'upstream unavailable':'{"data":{"klines":["2026-11-12,1,1,1,1"]}}'};
    },wait:async ms=>delays.push(ms),
  });
  assert.equal(calls.length,3);
  assert.equal(result.data.klines.length,1);
  assert.deepEqual(delays,[2000,6000]);
  for(const call of calls){
    assert.equal(call.binary,'curl');
    assert.ok(call.args.includes('--http1.1'));
    assert.ok(call.args.includes('Referer: https://quote.eastmoney.com/'));
  }
  assert.ok(calls[1].args.includes('Cache-Control: no-cache'));
});

test('each source receives its own referer and exhausted network failures still stop the update',async()=>{
  for(const [url,referer]of [['https://api.nasdaq.com/api/quote/SPY/historical','https://www.nasdaq.com/'],['https://web.ifzq.gtimg.cn/appstock/app/kline/kline','https://gu.qq.com/']]){
    await requestJSON(url,{run:async(_,args)=>{assert.ok(args.includes('Referer: '+referer));return {stdout:'{}'};}});
  }
  let calls=0;const delays=[],failure=Error('TLS connection failed');
  await assert.rejects(requestJSON(url,{run:async()=>{calls++;throw failure;},wait:async ms=>delays.push(ms)}),error=>error===failure);
  assert.equal(calls,3);assert.deepEqual(delays,[2000,6000]);
});
