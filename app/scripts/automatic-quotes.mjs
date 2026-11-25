import fs from 'node:fs';
import {CHAINS,RAW_DIR,fileFor} from './assets.mjs';
import {tradingDate,isClosed} from './process.mjs';
import {reconcileRaw,resolutionScale} from './reconcile-history.mjs';
import {eastmoneyHistoryMirror,requestJSON} from './quote-http.mjs';
import {PRICE_FIELDS,isAsian,currencyFor,toleranceFor,validBar,samePrice,sameBar,fetchBars,sourceObservation,primaryObservation,normalizeSymbol,priceBasisThrough} from './quote-sources.mjs';

export const AUTOMATIC_FILE=new URL('../data/automatic-quote-resolutions.json',import.meta.url);
const sourceHosts={'Yahoo Finance':'query1.finance.yahoo.com','Nasdaq':'api.nasdaq.com','Tencent Finance':'web.ifzq.gtimg.cn','Eastmoney':'push2his.eastmoney.com','CNBC':'quote.cnbc.com'};
const near=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=Math.max(1e-5,Math.abs(b)*1e-7);
function sourceMatches(source,record) {
  const ticker=CHAINS[record.id].at(-1),url=new URL(source.url);
  let identity=false;
  if(source.name==='Yahoo Finance')identity=decodeURIComponent(url.pathname.split('/').at(-1))===ticker;
  if(source.name==='Nasdaq')identity=normalizeSymbol(decodeURIComponent(url.pathname.split('/')[3]))===normalizeSymbol(ticker);
  if(source.name==='CNBC')identity=!isAsian(ticker)&&url.pathname==='/quote-html-webservice/restQuote/symbolType/symbol'&&url.searchParams.get('symbols')===ticker.replace('-','.');
  if(source.name==='Tencent Finance'){
    const code=url.searchParams.get('param')?.split(',')[0];
    const expected=ticker.endsWith('.HK')?'hk'+ticker.split('.')[0].padStart(5,'0'):(ticker.endsWith('.SZ')?'sz':'sh')+ticker.split('.')[0];
    identity=isAsian(ticker)?code===expected:['OQ','N','AM'].some(venue=>code==='us'+normalizeSymbol(ticker)+'.'+venue);
  }
  if(source.name==='Eastmoney'){
    const expected=(ticker.endsWith('.HK')?'116':ticker.endsWith('.SZ')?'0':'1')+'.'+(ticker.endsWith('.HK')?ticker.split('.')[0].padStart(5,'0'):ticker.split('.')[0]);
    identity=isAsian(ticker)&&url.searchParams.get('secid')===expected&&url.searchParams.get('fqt')==='0';
  }
  const knownHost=sourceHosts[source.name]===url.hostname||(source.name==='Eastmoney'&&url.hostname===eastmoneyHistoryMirror);
  return identity&&source.ticker===ticker&&source.currency===record.currency&&source.date===record.date&&knownHost&&validBar(source.bar)&&samePrice(source.value,source.bar.close,1e-10);
}

export function validateAutomaticArchive(archive) {
  if(archive?.schemaVersion!==1||!Array.isArray(archive.records))throw Error('Invalid automatic quote archive');
  const keys=new Set();
  for(const record of archive.records){
    const key=record.id+':'+record.date,ticker=CHAINS[record.id]?.at(-1);
    if(!ticker||keys.has(key)||!/^\d{4}-\d{2}-\d{2}$/.test(record.date)||!/^\d{4}-\d{2}-\d{2}$/.test(record.basisThrough)||record.basisThrough<record.date||record.currency!==currencyFor(ticker)||!Number.isFinite(Date.parse(record.reviewedAt))||!['correct-primary','retain-primary','fill-primary'].includes(record.action)||!validBar({...record.acceptedFields,close:record.acceptedClose}))throw Error(`Invalid automatic quote resolution ${key}`);
    keys.add(key);
    const tolerance=toleranceFor(record.id,ticker),support=record.sources?.filter(source=>sourceMatches(source,record)&&samePrice(source.value,record.acceptedClose,tolerance))||[];
    const names=new Set(support.map(source=>source.name));
    if(names.size<2)throw Error(`${key}: automatic resolution requires two independent agreeing sources`);
    if(record.action!=='retain-primary'){
      const bars=support.filter(source=>source.name!=='Yahoo Finance'&&sameBar(source.bar,record.acceptedFields,tolerance));
      if(new Set(bars.map(source=>source.name)).size<2)throw Error(`${key}: every replacement OHLC needs two non-primary sources`);
    }
    if(record.action!=='fill-primary'&&!(record.originalPrimaryClose>0))throw Error(`${key}: invalid observed primary close`);
    if(!record.originalPrimaryFields||PRICE_FIELDS.some(key=>!Object.hasOwn(record.originalPrimaryFields,key)))throw Error(`${key}: missing original price evidence`);
  }
  return archive;
}

export function loadAutomaticArchive(file=AUTOMATIC_FILE) {
  return validateAutomaticArchive(fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{schemaVersion:1,records:[]});
}

export function importLegacyRepairs(archive,legacy) {
  let next=structuredClone(archive);
  for(const old of legacy){
    if(next.records.some(record=>record.id===old.id&&record.date===old.date))continue;
    if(CHAINS[old.id]?.at(-1)!==old.ticker||!validBar(old.ohlc)||old.sources?.length!==old.urls?.length)throw Error('Invalid legacy quote-repair evidence');
    const currency=currencyFor(old.ticker),record={id:old.id,date:old.date,currency,basisThrough:old.basisThrough||old.verifiedAt.slice(0,10),reviewedAt:old.verifiedAt,
      action:'fill-primary',originalPrimaryClose:null,originalSecondaryClose:old.ohlc.close,
      originalPrimaryFields:Object.fromEntries(PRICE_FIELDS.map(key=>[key,null])),acceptedFields:old.ohlc,acceptedClose:old.ohlc.close,
      sources:old.sources.map((name,index)=>({name,url:old.urls[index],ticker:old.ticker,currency,date:old.date,value:old.ohlc.close,bar:old.ohlc,checkedAt:old.verifiedAt})),
      automatic:true,legacy:true,finding:old.reason};
    next=addAutomaticRecords(next,[record]);
  }
  return next;
}

export function mergeQuoteEvidence(manual,automatic,active=automatic.records) {
  const keys=new Set(manual.records.map(record=>record.id+':'+record.date));
  const records=[...manual.records];
  for(const record of active){
    if(keys.has(record.id+':'+record.date))throw Error('Automatic quote resolution overlaps a manually reviewed date');
    if(record.action!=='fill-primary')records.push(record);
  }
  return {...manual,records};
}

function dateIndex(raw,date) {return raw.timestamp.findIndex(time=>tradingDate(time,raw.meta.exchangeTimezoneName)===date);}
function dateAnchor(date,zone) {
  const noon=Date.parse(date+'T12:00:00Z'),parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(noon)).map(part=>[part.type,part.value]));
  const localAsUTC=Date.UTC(+parts.year,+parts.month-1,+parts.day,+parts.hour,+parts.minute,+parts.second);
  return (noon-(localAsUTC-noon))/1000;
}

// Fill absent raw prices only; existing adjusted factors remain intact. The
// independent dividend-factor audit is still required before any publication.
export function fillVerifiedBar(input,record) {
  const raw=structuredClone(input),ticker=CHAINS[record.id]?.at(-1);
  if(raw.meta.symbol!==ticker||raw.meta.currency!==record.currency)throw Error('Automatic fill security identity/currency mismatch');
  const scale=resolutionScale(raw,record),bar=Object.fromEntries(PRICE_FIELDS.map(key=>[key,record.acceptedFields[key]*scale]));
  const quote=raw.indicators.quote[0],adjusted=raw.indicators.adjclose[0].adjclose;
  let index=dateIndex(raw,record.date);
  if(index<0){
    const time=dateAnchor(record.date,raw.meta.exchangeTimezoneName);
    index=raw.timestamp.findIndex(value=>value>time);if(index<0)index=raw.timestamp.length;
    raw.timestamp.splice(index,0,time);
    for(const values of Object.values(quote))values.splice(index,0,null);
    adjusted.splice(index,0,null);
  }
  if(quote.close[index]>0&&!sameBar(Object.fromEntries(PRICE_FIELDS.map(key=>[key,quote[key][index]])),bar,toleranceFor(record.id,ticker)))throw Error('A changed filled quote requires fresh verification');
  const legacyFill=raw.verifiedRepairs?.find(item=>item.date===record.date);
  const originalFields=legacyFill?(legacyFill.originalPrimaryFields||Object.fromEntries(PRICE_FIELDS.map(key=>[key,null]))):Object.fromEntries(PRICE_FIELDS.map(key=>[key,quote[key]?.[index]??null]));
  const priorFill=raw.automaticQuoteFills?.find(item=>item.date===record.date);
  const wasMissing=!(quote.close[index]>0);
  for(const key of PRICE_FIELDS)quote[key][index]=bar[key];
  if(wasMissing)adjusted[index]=null;
  const valid=quote.close.map((price,i)=>price>0?i:null).filter(i=>i!==null),anchor=[...valid].reverse().find(i=>adjusted[i]>0);
  if(anchor==null)throw Error('No reported adjustment factor to anchor an automatic fill');
  const dividends=Object.fromEntries(Object.values(raw.events?.dividends||{}).map(event=>[tradingDate(event.date,raw.meta.exchangeTimezoneName),event.amount]));
  let factor=adjusted[anchor]/quote.close[anchor];
  // If the latest bar was missing, use the vendor's total-return normalization
  // at the end of the daily series and validate all prior factors independently.
  if(anchor!==valid.at(-1))factor=1;
  for(let n=valid.length-1;n>=0;n--){
    const i=valid[n];if(!(adjusted[i]>0))adjusted[i]=quote.close[i]*factor;
    if(n>0)factor*=1-(dividends[tradingDate(raw.timestamp[i],raw.meta.exchangeTimezoneName)]||0)/quote.close[valid[n-1]];
  }
  raw.automaticQuoteFills=[...(raw.automaticQuoteFills||[]).filter(item=>item.date!==record.date),{id:record.id,ticker,date:record.date,reviewedAt:record.reviewedAt,sources:record.sources.map(source=>source.name),ohlc:bar,originalPrimaryFields:priorFill?.originalPrimaryFields||originalFields,timestampBasis:'local-calendar-date anchor'}];
  return raw;
}

export function replayAutomaticArchive(archive,{rawDir=RAW_DIR}={}) {
  validateAutomaticArchive(archive);
  const active=[],pending=[],staged=new Map();
  for(const record of archive.records){
    const ticker=CHAINS[record.id].at(-1),file=new URL(fileFor(ticker),rawDir);
    let envelope=staged.get(file.href)||JSON.parse(fs.readFileSync(file,'utf8')),raw=envelope.chart.result[0];
    if(raw.meta.symbol!==ticker||raw.meta.currency!==record.currency)throw Error('Archived automatic quote security identity/currency changed');
    const index=dateIndex(raw,record.date),quote=raw.indicators.quote[0],scale=resolutionScale(raw,record);
    const observed=index<0?null:quote.close[index];
    if(record.action==='fill-primary'){
      const accepted=Object.fromEntries(PRICE_FIELDS.map(key=>[key,record.acceptedFields[key]*scale]));
      if(observed>0&&!sameBar(Object.fromEntries(PRICE_FIELDS.map(key=>[key,quote[key]?.[index]])),accepted,toleranceFor(record.id,ticker))){pending.push(record);continue;}
      raw=fillVerifiedBar(raw,record);
    }else{
      const prior=raw.historicalReconciliations?.find(item=>item.date===record.date);
      const priorMultiplier=prior?resolutionScale(raw,{...record,basisThrough:prior.basisThrough||record.basisThrough})/prior.scale:1;
      const known=index>=0&&PRICE_FIELDS.every(key=>{
        const value=quote[key]?.[index],original=record.originalPrimaryFields[key],accepted=record.acceptedFields[key];
        const followsPrior=prior&&near(value,prior.fields?.[key]*priorMultiplier);
        const source=prior?.sourceFields?.[key];
        return near(value,accepted*scale)||(original==null?value==null:near(value,original*scale))||(followsPrior&&(original==null?source==null:near(source*priorMultiplier,original*scale)));
      });
      if(!known){pending.push(record);continue;}
      const priorChecks=raw.historicalReconciliations||[];
      raw=reconcileRaw(raw,[record],{reviewedAt:record.reviewedAt}).raw;
      raw.historicalReconciliations=[...priorChecks.filter(item=>item.date!==record.date),...raw.historicalReconciliations];
    }
    envelope={...envelope,chart:{...envelope.chart,result:[raw]}};staged.set(file.href,envelope);active.push(record);
  }
  for(const [href,envelope]of staged)fs.writeFileSync(new URL(href),JSON.stringify(envelope));
  return {active,pending};
}

export function chooseQuote({id,ticker,date,primary,secondary,third,basisThrough,now=Date.now(),previous=null}) {
  const tolerance=toleranceFor(id,ticker),firstValid=primary?.value>0&&validBar(primary.bar);
  if(firstValid&&secondary&&samePrice(primary.value,secondary.value,tolerance)&&!previous)return {accepted:primary.value,verifier:secondary,record:null};
  if(!third)throw Error(`${id} ${date}: no independent third source for missing/conflicting quote`);
  const agreesPrimary=firstValid&&samePrice(primary.value,third.value,tolerance);
  const agreesSecondary=secondary&&sameBar(secondary.bar,third.bar,tolerance);
  let action,acceptedFields;
  if(agreesPrimary&&(!secondary||!agreesSecondary)){
    if(!secondary)return {accepted:primary.value,verifier:third,record:null};
    action='retain-primary';acceptedFields={...primary.bar};
  }else if(agreesSecondary&&(!agreesPrimary||!firstValid)){
    action=primary?.value>0?'correct-primary':'fill-primary';acceptedFields={...secondary.bar};
  }else if(previous&&agreesPrimary&&agreesSecondary){
    action='retain-primary';acceptedFields={...primary.bar};
  }else throw Error(`${id} ${date}: sources disagree or the consensus is ambiguous`);
  const sources=[primary,secondary,third].filter(Boolean);
  const record={id,date,currency:currencyFor(ticker),basisThrough,reviewedAt:new Date(now).toISOString(),action,
    originalPrimaryClose:primary?.value??null,originalSecondaryClose:secondary?.value??null,originalSecondarySource:secondary?.name??null,
    originalPrimaryFields:primary?.bar||Object.fromEntries(PRICE_FIELDS.map(key=>[key,null])),acceptedFields,acceptedClose:acceptedFields.close,
    sources,automatic:true,finding:'Automatically verified same-security, same-currency, same-date market prices; replacements require two independent non-primary OHLC sources.',
    ...(previous?{previous}: {})};
  validateAutomaticArchive({schemaVersion:1,records:[record]});
  return {accepted:record.acceptedClose,verifier:action==='retain-primary'?third:secondary,record};
}

export function addAutomaticRecords(archive,records) {
  const next=structuredClone(archive);
  for(const record of records){const index=next.records.findIndex(item=>item.id===record.id&&item.date===record.date);if(index<0)next.records.push(record);else next.records[index]=record;}
  next.records.sort((a,b)=>a.id.localeCompare(b.id)||a.date.localeCompare(b.date));
  return validateAutomaticArchive(next);
}

function archivedDecision(record,{raw,id,ticker,primary,secondary}) {
  if(!record||!primary||!secondary)return null;
  const scale=resolutionScale(raw,record),target=record.acceptedClose*scale,tolerance=toleranceFor(id,ticker);
  if(!near(primary.canonicalBar.close,target))return null;
  const support=record.sources.filter(source=>samePrice(source.value,record.acceptedClose,tolerance)).map(source=>({...source,value:source.value*scale,
    bar:Object.fromEntries(PRICE_FIELDS.map(key=>[key,source.bar?.[key]*scale])),archived:true}));
  if(samePrice(secondary.value,target,tolerance))return {accepted:target,verifier:secondary,record:null,supportingSources:[...new Set([...support.map(source=>source.name),secondary.name])],archived:true};
  if(record.action==='retain-primary'&&secondary.name===(record.originalSecondarySource||(isAsian(ticker)?'Tencent Finance':'Nasdaq'))&&samePrice(primary.value,target,tolerance)&&samePrice(secondary.value,record.originalSecondaryClose*scale,tolerance)){
    const verifier=support.find(source=>source.name!=='Yahoo Finance');
    if(verifier)return {accepted:target,verifier,record:null,supportingSources:[...new Set(support.map(source=>source.name))],archived:true};
  }
  return null;
}

export async function recoverRecentQuotes({asOf,rawDir=RAW_DIR,archive={schemaVersion:1,records:[]},manual={records:[]},pending=[],request=requestJSON,now=Date.now(),retryDelays=[10000,30000],wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),log=console.warn,entries=Object.entries(CHAINS)}={}) {
  const results=[],records=[],failures=[];let cursor=0;
  async function worker(){
    while(cursor<entries.length){
      const [id,chain]=entries[cursor++],ticker=chain.at(-1);
      try{
        const raw=JSON.parse(fs.readFileSync(new URL(fileFor(ticker),rawDir),'utf8')).chart.result[0],quote=raw.indicators.quote[0];
        const existing=raw.timestamp.map((time,index)=>({date:tradingDate(time,raw.meta.exchangeTimezoneName),index,time})).filter(item=>item.date<=asOf&&isClosed(item.time,raw.meta,now));
        const recent=existing.filter(item=>quote.close[item.index]>0).slice(-3).map(item=>item.date);
        const invalid=existing.filter(item=>(Date.parse(asOf)-Date.parse(item.date))/864e5<=20&&!validBar(Object.fromEntries(PRICE_FIELDS.map(key=>[key,quote[key]?.[item.index]])))).map(item=>item.date);
        const dates=[...new Set([...recent,...invalid,asOf,...pending.filter(record=>record.id===id).map(record=>record.date)])].sort();
        if(!dates.length)throw Error('No primary quote dates');
        const firstSource=isAsian(ticker)?'Tencent Finance':'Nasdaq',thirdSource=isAsian(ticker)?'Eastmoney':'Tencent Finance';
        let lastError;
        for(let attempt=0;attempt<=retryDelays.length;attempt++){
          let first,third,firstError,thirdError;
          try{first=await fetchBars({id,ticker,raw,source:firstSource,from:dates[0],to:asOf,request,now,attempt});}catch(error){firstError=error;}
          const observations=[],proposed=[];
          try{
            for(const date of dates){
              const index=dateIndex(raw,date),primary=index<0?null:primaryObservation({ticker,raw,date,index,now});
              let secondary=first?sourceObservation(first,date):null;
              const previous=archive.records.find(record=>record.id===id&&record.date===date)||null;
              const manualRecord=manual.records.find(record=>record.id===id&&record.date===date);
              const pendingDate=pending.some(record=>record.id===id&&record.date===date);
              let known=pendingDate?null:archivedDecision(manualRecord||previous,{raw,id,ticker,primary,secondary});
              const needsThird=!known&&(previous||!validBar(primary?.bar)||!secondary||!samePrice(primary.value,secondary.value,toleranceFor(id,ticker)));
              if(needsThird&&!third&&!thirdError){
                try{third=await fetchBars({id,ticker,raw,source:thirdSource,from:dates[0],to:asOf,request,now,attempt});}
                catch(error){thirdError=error;}
              }
              let last=third?sourceObservation(third,date):null;
              if(needsThird&&thirdError&&(isAsian(ticker)||date!==asOf))throw thirdError;
              if(!known&&!pendingDate&&last)known=archivedDecision(manualRecord||previous,{raw,id,ticker,primary,secondary:last});
              // Only replace a missing independent vote. A disagreement among
              // three available providers still goes through the normal rules.
              const verifiedByTencent=last&&validBar(primary?.bar)&&samePrice(primary.value,last.value,toleranceFor(id,ticker));
              const missingVote=!last||(!secondary&&!verifiedByTencent);
              if(needsThird&&!known&&!isAsian(ticker)&&date===asOf&&missingVote){
                const feed=await fetchBars({id,ticker,raw,source:'CNBC',from:date,to:date,request,now,attempt});
                const backup=sourceObservation(feed,date);
                if(backup){
                  secondary=secondary||last;last=backup;
                  if(!pendingDate)known=archivedDecision(manualRecord||previous,{raw,id,ticker,primary,secondary:backup});
                }
              }
              if(isAsian(ticker)&&!primary?.value&&!secondary&&!last&&!pending.some(record=>record.id===id&&record.date===date))continue; // Local holiday: no bar is fabricated.
              const decision=known||chooseQuote({id,ticker,date,primary,secondary,third:last,basisThrough:priceBasisThrough(raw,asOf,now),now,previous});
              if(manualRecord&&decision.record)throw Error(`${id} ${date}: a manually reviewed value changed; human review is required`);
              if(decision.record)proposed.push(decision.record);
              observations.push({date,primary:decision.accepted,secondary:decision.verifier.value,difference:Math.abs(decision.accepted-decision.verifier.value),source:decision.verifier.name,url:decision.verifier.url,
                verified:true,supportingSources:decision.supportingSources||(decision.record?decision.record.sources.filter(source=>validBar(source.bar)&&samePrice(source.value,decision.accepted,toleranceFor(id,ticker))).map(source=>source.name):['Yahoo Finance',decision.verifier.name]),
                ...(decision.verifier.quoteKind?{quoteKind:decision.verifier.quoteKind,sessionTime:decision.verifier.sessionTime}:{}),
                ...(decision.archived?{archivedResolution:true}:{}),
                ...(decision.record?{resolution:decision.record.action,originalPrimary:primary?.value??null,originalSecondary:secondary?.value??null}:{}),...(firstError?{unavailableSource:firstSource}: {})});
            }
            const current=observations.filter(item=>!pending.some(record=>record.id===id&&record.date===item.date)||recent.includes(item.date)||item.date===asOf).slice(-3);
            if(!current.length)throw Error('No independently verified current quotes');
            if(!isAsian(ticker)&&!current.some(item=>item.date===asOf))throw Error('Latest US close is unavailable');
            results.push({id,ticker,source:[...new Set(current.map(item=>item.source))].join(' / '),url:current.at(-1).url,attempts:attempt+1,tolerance:toleranceFor(id,ticker),observations:current});
            records.push(...proposed);lastError=null;break;
          }catch(error){lastError=error;}
          if(attempt<retryDelays.length){log(`${id}: ${lastError.message}; refreshing sources in ${retryDelays[attempt]/1000}s`);await wait(retryDelays[attempt]);}
        }
        if(lastError)throw lastError;
      }catch(error){failures.push(`${id}: ${error.message}`);}
    }
  }
  await Promise.all(Array.from({length:4},worker));
  if(failures.length)throw Error('Automatic quote verification unresolved:\n'+failures.join('\n'));
  const automatic=addAutomaticRecords(archive,records);
  return {automatic,newRecords:records,verification:{checkedAt:new Date(now).toISOString(),asOf,assets:results.length,observations:results.reduce((sum,result)=>sum+result.observations.length,0),results:results.sort((a,b)=>a.id.localeCompare(b.id))}};
}

export async function resolveHistoricalQuotes(history,{asOf,rawDir=RAW_DIR,archive,manual,request=requestJSON,now=Date.now()}={}) {
  const records=[];
  for(const result of history.results){
    if(!result.unresolvedDifferences.length)continue;
    const id=result.id,ticker=CHAINS[id].at(-1),raw=JSON.parse(fs.readFileSync(new URL(fileFor(ticker),rawDir),'utf8')).chart.result[0];
    for(const difference of result.unresolvedDifferences){
      if(manual.records.some(record=>record.id===id&&record.date===difference.date))throw Error(`${id} ${difference.date}: a manually reviewed value changed; human review is required`);
      const date=difference.date,index=dateIndex(raw,date),primary=primaryObservation({ticker,raw,date,index,now});
      const secondary={name:'Nasdaq',url:result.url,ticker,currency:'USD',date,value:difference.nasdaq,bar:difference.secondaryBar,checkedAt:history.checkedAt,sha256:result.responseSha256};
      const feed=await fetchBars({id,ticker,raw,source:'Tencent Finance',from:date,to:date,through:priceBasisThrough(raw,asOf,now),request,now});
      const third=sourceObservation(feed,date),previous=archive.records.find(record=>record.id===id&&record.date===date)||null;
      const decision=chooseQuote({id,ticker,date,primary,secondary,third,basisThrough:priceBasisThrough(raw,asOf,now),now,previous});
      if(decision.record)records.push(decision.record);
    }
  }
  return {automatic:addAutomaticRecords(archive,records),newRecords:records};
}
