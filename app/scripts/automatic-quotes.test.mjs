import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {CHAINS,fileFor} from './assets.mjs';
import {tradingDate} from './process.mjs';
import {PRICE_FIELDS,fetchBars,sourceCodes,splitFactor,priceBasisThrough} from './quote-sources.mjs';
import {chooseQuote,recoverRecentQuotes,replayAutomaticArchive,loadAutomaticArchive,validateAutomaticArchive,mergeQuoteEvidence,resolveHistoricalQuotes,importLegacyRepairs} from './automatic-quotes.mjs';

const dates=['2026-11-12','2026-11-13','2026-11-16'],asOf=dates.at(-1),now=Date.parse('2026-11-17T06:00:00Z');
const bar=value=>({open:value,high:value+1,low:value-1,close:value});
const empty=()=>({schemaVersion:1,records:[]});
function fixture(t,id='SOEDIV'){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'rebalance-auto-quotes-'));
  t.after(()=>{
    assert.equal(path.dirname(directory),fs.realpathSync(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('rebalance-auto-quotes-'));
    fs.rmSync(directory,{recursive:true,force:true});
  });
  const ticker=CHAINS[id].at(-1),asian=/\.(SS|SZ|HK)$/.test(ticker);
  const raw={meta:{symbol:ticker,currency:asian?'CNY':'USD',exchangeTimezoneName:asian?'Asia/Shanghai':'America/New_York',exchangeName:asian?'SHH':'PCX',instrumentType:'ETF'},
    timestamp:dates.map(date=>Date.parse(date+(asian?'T01:30Z':'T14:30Z'))/1000),
    indicators:{quote:[{...Object.fromEntries(PRICE_FIELDS.map(key=>[key,dates.map(()=>bar(100)[key])])),volume:[1,1,1]}],adjclose:[{adjclose:[100,100,100]}]}};
  const rawDir=pathToFileURL(directory+path.sep),file=new URL(fileFor(ticker),rawDir);
  const save=()=>fs.writeFileSync(file,JSON.stringify({chart:{result:[raw]}}));save();
  const read=()=>JSON.parse(fs.readFileSync(file)).chart.result[0];
  return {directory,rawDir,file,raw,save,read,id,ticker};
}

function network(f,{nasdaq,tencent,eastmoney,changeResponse}={}){
  const calls=[];
  const request=async(url,options)=>{
    const source=url.includes('nasdaq.com')?'Nasdaq':url.includes('gtimg.cn')?'Tencent Finance':'Eastmoney';
    const count=calls.filter(call=>call.source===source).length+1;
    calls.push({source,url,options,count});
    let supplied=source==='Nasdaq'?nasdaq:source==='Tencent Finance'?tencent:eastmoney;
    if(typeof supplied==='function')supplied=supplied(count,url);
    if(supplied instanceof Error)throw supplied;
    const rows=supplied||dates.map(date=>({date,...bar(100)}));
    const codes=sourceCodes(f.id,f.ticker,f.raw);
    let response;
    if(source==='Nasdaq')response={data:{symbol:f.ticker.replace('-','.'),totalRecords:rows.length,tradesTable:{rows:rows.map(row=>({date:row.date.slice(5,7)+'/'+row.date.slice(8)+'/'+row.date.slice(0,4),...Object.fromEntries(PRICE_FIELDS.map(key=>[key,'$'+row[key]]))}))}}};
    else if(source==='Tencent Finance')response={data:{[codes.tencent]:{day:rows.map(row=>[row.date,row.open,row.close,row.high,row.low,1]),qt:{[codes.tencent]:['','Test security',codes.tencent.replace(/^(us|sh|sz|hk)/,''),f.raw.meta.currency]}}}};
    else {const [market,code]=codes.eastmoney.split('.');response={data:{market:+market,code,klines:rows.map(row=>[row.date,row.open,row.close,row.high,row.low,1].join(','))}};}
    return changeResponse?changeResponse(response,source,count):response;
  };
  return {calls,request};
}
const run=(f,net,options={})=>recoverRecentQuotes({asOf,rawDir:f.rawDir,request:net.request,now,retryDelays:[],log:()=>{},entries:[[f.id,CHAINS[f.id]]],...options});
function flat(f,value,index=2){for(const key of PRICE_FIELDS)f.raw.indicators.quote[0][key][index]=value;f.raw.indicators.adjclose[0].adjclose[index]=value;f.save();}
function observed(source,value,barValue=bar(value)){
  const urls={'Yahoo Finance':'https://query1.finance.yahoo.com/v8/finance/chart/SPY','Nasdaq':'https://api.nasdaq.com/api/quote/SPY/historical','Tencent Finance':'https://web.ifzq.gtimg.cn/appstock/app/kline/kline?param=usSPY.AM,day,2026-11-12,2026-11-16,640'};
  return {name:source,ticker:'SPY',currency:'USD',date:asOf,value,bar:barValue,url:urls[source],checkedAt:new Date(now).toISOString()};
}

test('ordinary agreement uses one independent source and does not create a correction',async t=>{
  const f=fixture(t,'SPY'),net=network(f),result=await run(f,net);
  assert.equal(net.calls.length,1);assert.equal(result.newRecords.length,0);
  assert.equal(result.verification.observations,3);
  assert.ok(result.verification.results[0].observations.every(row=>row.verified&&row.difference===0));
});

test('late Nasdaq closes automatically fall back to matching Tencent dates without dropping the latest date',async t=>{
  const f=fixture(t,'SPY'),net=network(f,{nasdaq:dates.slice(0,2).map(date=>({date,...bar(100)}))});
  const result=await run(f,net),last=result.verification.results[0].observations.at(-1);
  assert.equal(last.date,asOf);assert.equal(last.source,'Tencent Finance');
  assert.deepEqual(last.supportingSources,['Yahoo Finance','Tencent Finance']);
  assert.equal(result.automatic.records.length,0);assert.equal(net.calls.length,2);
});

test('an exhausted first-source network error can recover through a verified alternate source',async t=>{
  const f=fixture(t,'SPY'),net=network(f,{nasdaq:Error('TLS retries exhausted')});
  const result=await run(f,net);
  assert.ok(result.verification.results[0].observations.every(row=>row.source==='Tencent Finance'&&row.unavailableSource==='Nasdaq'));
  assert.equal(result.verification.observations,3);
});

function usCloseNetwork(f,{quoteTime=asOf+' 16:00:01',regular={},tencentDown=false}={}){
  const older=dates.slice(0,-1).map(date=>({date,...bar(100)}));
  const qt=Array(47).fill('');
  Object.assign(qt,{2:'SPY.AM',3:'100',5:'100',30:quoteTime,33:'101',34:'99',35:'USD'});
  const base=network(f,{nasdaq:older,tencent:tencentDown?Error('Tencent unavailable'):older,changeResponse:(r,s)=>{
    if(s==='Tencent Finance')Object.assign(r.data['usSPY.AM'],{qt:{'usSPY.AM':qt},pandata:{last:'120',tag:'after'}});
    return r;
  }});
  return {request:async url=>{
    if(!url.includes('quote.cnbc.com'))return base.request(url);
    return {FormattedQuoteResult:{FormattedQuote:[{code:0,symbol:'SPY',exchange:'NYSE Arca',countryCode:'US',currencyCode:'USD',
      curmktstatus:'POST_MKT',last_time:asOf+'T16:10:00.000-0500',last:'100',open:'100',low:'99',high:'101',
      ExtendedMktQuote:{last:'120',last_time:asOf+'T19:59:00.000-0500'},...regular}]}};
  }};
}

test('a null Yahoo close and two late daily histories recover from two regular-session closes',async t=>{
  const f=fixture(t,'SPY');f.raw.indicators.quote[0].close[2]=null;f.raw.indicators.adjclose[0].adjclose[2]=null;f.save();
  const result=await run(f,usCloseNetwork(f));
  const record=result.newRecords[0],last=result.verification.results[0].observations.at(-1);
  assert.equal(record.action,'fill-primary');assert.equal(record.originalPrimaryClose,null);
  assert.deepEqual(last.supportingSources,['Tencent Finance','CNBC']);
  assert.equal(last.primary,100);assert.equal(last.quoteKind,'regular-session close');
  assert.deepEqual(record.sources.filter(s=>s.quoteKind).map(s=>s.sessionTime),[asOf+' 16:00:01',asOf+'T16:10:00.000-0500']);
  replayAutomaticArchive(result.automatic,{rawDir:f.rawDir});assert.equal(f.read().indicators.adjclose[0].adjclose[2],100);
  const invalid=structuredClone(result.automatic);
  invalid.records[0].sources.find(s=>s.name==='CNBC').url=invalid.records[0].sources.find(s=>s.name==='CNBC').url.replace('symbols=SPY','symbols=OTHER');
  assert.throws(()=>validateAutomaticArchive(invalid),/independent|non-primary/);
});

test('a CNBC close alone can confirm a valid Yahoo bar but cannot supply a missing bar alone',async t=>{
  const f=fixture(t,'SPY'),net=usCloseNetwork(f,{tencentDown:true});
  const result=await run(f,net);
  assert.deepEqual(result.verification.results[0].observations.at(-1).supportingSources,['Yahoo Finance','CNBC']);
  f.raw.indicators.quote[0].close[2]=null;f.save();
  await assert.rejects(run(f,net),/unresolved/);
});

test('stale, intraday and extended quotes, wrong instruments and nonmatching OHLC cannot fill the close',async t=>{
  const f=fixture(t,'SPY');f.raw.indicators.quote[0].close[2]=null;f.save();
  for(const options of [{quoteTime:asOf+' 15:59:59'},{quoteTime:asOf+' 18:15:00'},{quoteTime:dates[1]+' 16:00:01'},
    {regular:{symbol:'SPX'}},{regular:{currencyCode:'CAD'}},{regular:{exchange:'NASDAQ'}},{regular:{high:'103'}},
    {regular:{curmktstatus:'REG_MKT'}},{regular:{last_time:asOf+'T16:10:00.000-0400'}},{regular:{last_time:asOf+'T20:00:00.000-0500'}}]){
    await assert.rejects(run(f,usCloseNetwork(f,options)),/unresolved/);
  }
  await assert.rejects(run(f,usCloseNetwork(f),{now:Date.parse(asOf+'T20:50:00Z')}),/unresolved/);
});

test('a new flat ETF quote is automatically replaced only after two external full OHLC bars agree',async t=>{
  const f=fixture(t);flat(f,101);
  const net=network(f),result=await run(f,net);
  assert.equal(result.automatic.records.length,1);
  assert.equal(result.newRecords[0].action,'correct-primary');
  assert.equal(f.read().indicators.quote[0].close[2],101,'verification stages evidence before mutating raw quotes');
  replayAutomaticArchive(result.automatic,{rawDir:f.rawDir});
  const fixed=f.read();assert.equal(fixed.indicators.quote[0].close[2],100);
  assert.equal(fixed.indicators.adjclose[0].adjclose[2],100);
  assert.equal(fixed.historicalReconciliations[0].sourceClose,101);
  const again=network(f),repeat=await run(f,again,{archive:result.automatic});
  assert.equal(repeat.automatic.records.length,1);assert.equal(repeat.newRecords.length,0);
  assert.equal(again.calls.length,1,'dated evidence replays without repeatedly requesting a third source');
  const proof=repeat.verification.results[0].observations.at(-1);
  assert.deepEqual(proof.supportingSources,['Tencent Finance','Eastmoney']);
  assert.ok(!proof.supportingSources.includes('Yahoo Finance'),'a corrected value cannot vote as original Yahoo evidence');
  const archiveFile=path.join(f.directory,'archive.json');fs.writeFileSync(archiveFile,JSON.stringify(result.automatic));
  assert.deepEqual(loadAutomaticArchive(archiveFile),result.automatic);
});

test('two equal closes with conflicting OHLC cannot authorize replacement of an ETF bar',async t=>{
  const f=fixture(t);flat(f,101);
  const net=network(f,{eastmoney:dates.map(date=>({date,...bar(100),high:103}))});
  await assert.rejects(run(f,net),/consensus is ambiguous|sources disagree/);
  assert.equal(f.read().indicators.quote[0].close[2],101);
});

test('a malformed positive-close bar needs two external bars before missing fields are repaired',async t=>{
  const f=fixture(t);f.raw.indicators.quote[0].open[2]=null;f.save();
  const result=await run(f,network(f));
  replayAutomaticArchive(result.automatic,{rawDir:f.rawDir});
  assert.equal(f.read().indicators.quote[0].open[2],100);
});

for(const omitted of [false,true])test(`a ${omitted?'fully omitted':'null'} US daily bar is filled using Nasdaq and Tencent`,async t=>{
  const f=fixture(t,'SPY');
  if(omitted){f.raw.timestamp.pop();for(const values of Object.values(f.raw.indicators.quote[0]))values.pop();f.raw.indicators.adjclose[0].adjclose.pop();}
  else {for(const key of PRICE_FIELDS)f.raw.indicators.quote[0][key][2]=null;f.raw.indicators.adjclose[0].adjclose[2]=null;}
  f.save();const result=await run(f,network(f));
  assert.equal(result.newRecords[0].action,'fill-primary');
  replayAutomaticArchive(result.automatic,{rawDir:f.rawDir});
  const fixed=f.read();assert.equal(fixed.timestamp.length,3);assert.equal(tradingDate(fixed.timestamp[2],fixed.meta.exchangeTimezoneName),asOf);
  assert.equal(fixed.indicators.quote[0].close[2],100);assert.equal(fixed.indicators.adjclose[0].adjclose[2],100);
  if(omitted)assert.equal(fixed.indicators.quote[0].volume[2],null,'unknown volume is not fabricated');
  assert.deepEqual(replayAutomaticArchive(result.automatic,{rawDir:f.rawDir}).pending,[]);
});

test('a local Asian holiday without bars in either independent source is not fabricated',async t=>{
  const f=fixture(t);f.raw.timestamp.pop();for(const values of Object.values(f.raw.indicators.quote[0]))values.pop();f.raw.indicators.adjclose[0].adjclose.pop();f.save();
  const rows=dates.slice(0,2).map(date=>({date,...bar(100)}));
  const result=await run(f,network(f,{tencent:rows,eastmoney:rows}));
  assert.equal(result.automatic.records.length,0);assert.equal(result.verification.results[0].observations.at(-1).date,'2026-11-13');
  assert.equal(f.read().timestamp.length,2);
});

test('persistent three-way conflict is retried with fresh queries and leaves prices unchanged',async t=>{
  const f=fixture(t);flat(f,101);const delays=[];
  const net=network(f,{tencent:dates.map(date=>({date,...bar(102)})),eastmoney:dates.map(date=>({date,...bar(103)}))});
  await assert.rejects(run(f,net,{retryDelays:[10,30],wait:async delay=>delays.push(delay)}),/unresolved/);
  assert.deepEqual(delays,[10,30]);assert.equal(net.calls.filter(call=>call.source==='Tencent Finance').length,3);
  assert.equal(new Set(net.calls.filter(call=>call.source==='Tencent Finance').map(call=>call.url)).size,3);
  assert.equal(f.read().indicators.quote[0].close[2],101);
});

test('rounding tolerance cannot manufacture an ambiguous two-against-one majority',()=>{
  assert.throws(()=>chooseQuote({id:'SPY',ticker:'SPY',date:asOf,basisThrough:asOf,now,
    primary:observed('Yahoo Finance',100),secondary:observed('Nasdaq',100.02),third:observed('Tencent Finance',100.01)}),/ambiguous/);
});

test('an unexpected later vendor value is reverified, preserving the prior dated evidence',async t=>{
  const f=fixture(t);flat(f,101);const first=await run(f,network(f));
  flat(f,101.5);const replay=replayAutomaticArchive(first.automatic,{rawDir:f.rawDir});
  assert.equal(replay.pending.length,1);
  const second=await run(f,network(f),{archive:first.automatic,pending:replay.pending});
  assert.equal(second.automatic.records[0].originalPrimaryClose,101.5);
  assert.equal(second.automatic.records[0].previous.originalPrimaryClose,101);
  replayAutomaticArchive(second.automatic,{rawDir:f.rawDir});assert.equal(f.read().indicators.quote[0].close[2],100);
});

test('an incorrect secondary quote is retained as rejected evidence when Yahoo and the third source agree',async t=>{
  const f=fixture(t,'SPY'),net=network(f,{nasdaq:dates.map(date=>({date,...bar(date===asOf?101:100)}))});
  const result=await run(f,net),record=result.newRecords[0];
  assert.equal(record.action,'retain-primary');assert.equal(record.originalSecondaryClose,101);assert.equal(record.acceptedClose,100);
  assert.deepEqual(f.read().indicators.quote[0].close,[100,100,100]);
  validateAutomaticArchive(result.automatic);
});

test('Eastmoney mirror supplies one independent vote after a failed connection',async t=>{
  const f=fixture(t);
  flat(f,101);
  const net=network(f,{eastmoney:(_count,url)=>new URL(url).hostname==='push2his.eastmoney.com'?Error('connection closed'):undefined});
  const result=await run(f,net);
  const record=result.newRecords[0];
  assert.equal(record.acceptedClose,100);
  assert.deepEqual(record.sources.map(s=>s.name),['Yahoo Finance','Tencent Finance','Eastmoney']);
  assert.equal(new URL(record.sources.at(-1).url).hostname,'33.push2his.eastmoney.com');
  validateAutomaticArchive(result.automatic);
});

test('source identity and currency validation reject a wrong symbol even when prices happen to match',async t=>{
  const f=fixture(t,'SPY');
  for(const scenario of ['symbol','currency']){
    const net=network(f,{changeResponse:(response,source)=>{
      if(source==='Nasdaq'&&scenario==='symbol')response.data.symbol='OTHER';
      if(source==='Tencent Finance'&&scenario==='currency')response.data.usSPYAM=undefined;
      if(source==='Tencent Finance'&&scenario==='currency')response.data['usSPY.AM'].qt['usSPY.AM'][3]='CNY';
      return response;
    }});
    await assert.rejects(fetchBars({id:f.id,ticker:f.ticker,raw:f.raw,source:scenario==='symbol'?'Nasdaq':'Tencent Finance',from:dates[0],to:asOf,request:net.request,now}),/mismatch/);
  }
});

test('an archive cannot relabel a quote URL for another security or count one provider twice',async t=>{
  const f=fixture(t);flat(f,101);const result=await run(f,network(f));
  for(const scenario of ['url','duplicate','currency','date']){
    const archive=structuredClone(result.automatic),record=archive.records[0],source=record.sources.find(item=>item.name==='Eastmoney');
    if(scenario==='url')source.url=source.url.replace('1.561580','1.512800');
    if(scenario==='duplicate')source.name='Tencent Finance';
    if(scenario==='currency')source.currency='USD';
    if(scenario==='date')source.date='2026-11-13';
    assert.throws(()=>validateAutomaticArchive(archive),/independent|non-primary/);
  }
});

test('manual review dates cannot be silently superseded by an automatic record',async t=>{
  const f=fixture(t);flat(f,101);const result=await run(f,network(f));
  assert.throws(()=>mergeQuoteEvidence({records:[result.newRecords[0]]},result.automatic),/overlaps/);
});

test('effective splits normalize transaction-date bars while future announced splits do not',()=>{
  const raw={meta:{exchangeTimezoneName:'America/New_York'},timestamp:[Date.parse('2026-11-16T14:30Z')/1000],indicators:{quote:[{close:[100]}]},
    events:{splits:{old:{date:Date.parse('2026-11-13T14:30Z')/1000,numerator:4,denominator:1},future:{date:Date.parse('2026-11-18T14:30Z')/1000,numerator:2,denominator:1}}}};
  assert.equal(splitFactor(raw,'2026-11-12',asOf),.25);
  assert.equal(splitFactor(raw,asOf,asOf),1);
  assert.equal(priceBasisThrough(raw,asOf,now),asOf);
});

test('a persistent new historical disagreement is verified against Tencent without a manual exception',async t=>{
  const f=fixture(t,'SPY'),net=network(f),date=dates[0];
  const history={checkedAt:new Date(now).toISOString(),results:[{id:'SPY',url:'https://api.nasdaq.com/api/quote/SPY/historical',unresolvedDifferences:[{date,nasdaq:101,secondaryBar:bar(101)}]}]};
  const result=await resolveHistoricalQuotes(history,{asOf,rawDir:f.rawDir,archive:empty(),manual:{records:[]},request:net.request,now});
  assert.equal(result.newRecords[0].action,'retain-primary');assert.equal(result.newRecords[0].acceptedClose,100);
});

test('several corrected dates retain every original raw value when the archive is replayed',async t=>{
  const f=fixture(t);flat(f,101,1);flat(f,102,2);
  const recovered=await run(f,network(f));assert.equal(recovered.newRecords.length,2);
  replayAutomaticArchive(recovered.automatic,{rawDir:f.rawDir});
  assert.deepEqual(f.read().historicalReconciliations.map(record=>record.sourceClose),[101,102]);
  replayAutomaticArchive(recovered.automatic,{rawDir:f.rawDir});
  assert.deepEqual(f.read().historicalReconciliations.map(record=>record.sourceClose),[101,102]);
});

test('a previously filled bar can still be verified when its first provider is temporarily late',async t=>{
  const f=fixture(t,'SPY');for(const key of PRICE_FIELDS)f.raw.indicators.quote[0][key][2]=null;f.raw.indicators.adjclose[0].adjclose[2]=null;f.save();
  const first=await run(f,network(f));replayAutomaticArchive(first.automatic,{rawDir:f.rawDir});
  const late=network(f,{nasdaq:dates.slice(0,2).map(date=>({date,...bar(100)}))});
  const result=await run(f,late,{archive:first.automatic});
  assert.equal(result.newRecords.length,0);
  assert.equal(result.verification.results[0].observations.at(-1).source,'Tencent Finance');
  assert.deepEqual(result.verification.results[0].observations.at(-1).supportingSources,['Nasdaq','Tencent Finance']);
});

test('a correction on an ex-dividend date preserves the earlier dividend factor',async t=>{
  const f=fixture(t);flat(f,101);
  f.raw.events={dividends:{ex:{date:f.raw.timestamp[2],amount:1}}};
  f.raw.indicators.adjclose[0].adjclose[0]=99;f.raw.indicators.adjclose[0].adjclose[1]=99;f.save();
  const result=await run(f,network(f));replayAutomaticArchive(result.automatic,{rawDir:f.rawDir});
  assert.deepEqual(f.read().indicators.adjclose[0].adjclose,[99,99,100]);
});

test('archive replay rescales only already-effective subsequent splits and preserves the same-date evidence',async t=>{
  const f=fixture(t);flat(f,101);const result=await run(f,network(f));
  f.raw.timestamp.push(Date.parse('2026-11-17T01:30Z')/1000);
  for(const key of PRICE_FIELDS)f.raw.indicators.quote[0][key]=[...f.raw.indicators.quote[0][key].map(value=>value/2),bar(50)[key]];
  f.raw.indicators.quote[0].volume.push(1);f.raw.indicators.adjclose[0].adjclose=[50,50,50.5,50];
  f.raw.events={splits:{effective:{date:f.raw.timestamp[3],numerator:2,denominator:1},future:{date:f.raw.timestamp[3]+86400,numerator:3,denominator:1}}};f.save();
  const replay=replayAutomaticArchive(result.automatic,{rawDir:f.rawDir});
  assert.equal(replay.pending.length,0);assert.equal(f.read().indicators.quote[0].close[2],50);
  assert.equal(f.read().historicalReconciliations[0].sourceClose,50.5);
  assert.equal(priceBasisThrough(f.raw,asOf,now),'2026-11-17');
});

test('legacy missing-bar evidence migrates once without duplicate records or invented source votes',()=>{
  const legacy=JSON.parse(fs.readFileSync(new URL('../data/quote-repairs.json',import.meta.url)));
  const migrated=importLegacyRepairs(empty(),legacy);
  assert.equal(migrated.records.length,legacy.length);
  assert.deepEqual(importLegacyRepairs(migrated,legacy),migrated);
  assert.ok(migrated.records.every(record=>record.action==='fill-primary'&&record.sources.every(source=>source.name!=='Yahoo Finance')));
});

test('a revised two-source finding can replace an earlier automatic correction without losing the original vendor quote',async t=>{
  const f=fixture(t);flat(f,101);
  const first=await run(f,network(f));replayAutomaticArchive(first.automatic,{rawDir:f.rawDir});
  const revisedRows=dates.map(date=>({date,...bar(date===asOf?99:100)}));
  const revised=await run(f,network(f,{tencent:revisedRows,eastmoney:revisedRows}),{archive:first.automatic});
  const replay=replayAutomaticArchive(revised.automatic,{rawDir:f.rawDir});
  assert.equal(replay.pending.length,0);assert.equal(f.read().indicators.quote[0].close[2],99);
  assert.equal(f.read().historicalReconciliations[0].sourceClose,101);
  assert.equal(revised.automatic.records[0].previous.acceptedClose,100);
});

test('revising an automatic finding after a split uses each evidence record own price basis',async t=>{
  const f=fixture(t);flat(f,101);const first=await run(f,network(f));
  f.raw.timestamp.push(Date.parse('2026-11-17T01:30Z')/1000);
  for(const key of PRICE_FIELDS)f.raw.indicators.quote[0][key]=[...f.raw.indicators.quote[0][key].map(value=>value/2),bar(50)[key]];
  f.raw.indicators.quote[0].volume.push(1);f.raw.indicators.adjclose[0].adjclose=[50,50,50.5,50];
  f.raw.events={splits:{effective:{date:f.raw.timestamp[3],numerator:2,denominator:1}}};f.save();
  replayAutomaticArchive(first.automatic,{rawDir:f.rawDir});
  const rows=dates.map(date=>({date,...bar(date===asOf?98:100)}));
  const revised=await run(f,network(f,{tencent:rows,eastmoney:rows}),{archive:first.automatic});
  assert.equal(revised.newRecords[0].basisThrough,'2026-11-17');
  const replay=replayAutomaticArchive(revised.automatic,{rawDir:f.rawDir});
  assert.equal(replay.pending.length,0);assert.equal(f.read().indicators.quote[0].close[2],49);
  assert.equal(f.read().historicalReconciliations[0].sourceClose,50.5);
});
