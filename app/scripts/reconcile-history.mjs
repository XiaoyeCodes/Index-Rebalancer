// Dated, evidence-backed resolutions. Never use a general tolerance exemption.
// Reapply only a specifically observed vendor error, preserve its raw value, and
// fail if a subsequent fetch contains a third, unexplained value.
import fs from 'node:fs';
import {CHAINS,RAW_DIR,fileFor} from './assets.mjs';
import {tradingDate} from './process.mjs';

export const RESOLUTION_FILE=new URL('../data/history-resolutions.json',import.meta.url);
const near=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=Math.max(1e-5,Math.abs(b)*1e-7);
const corroborates=(a,b)=>Number.isFinite(a)&&Math.abs(a-b)<=.00051;

export function loadResolutions(file=RESOLUTION_FILE) {
  const evidence=JSON.parse(fs.readFileSync(file,'utf8')),seen=new Set();
  if(evidence.schemaVersion!==1||!Array.isArray(evidence.records))throw Error('Invalid historical-resolution schema');
  for(const r of evidence.records) {
    const key=r.id+':'+r.date;
    if(seen.has(key)||!CHAINS[r.id]||!/^\d{4}-\d{2}-\d{2}$/.test(r.date)||!/^\d{4}-\d{2}-\d{2}$/.test(r.basisThrough)||r.basisThrough<r.date||!(r.acceptedClose>0)||!near(r.acceptedFields?.close??r.acceptedClose,r.acceptedClose)||!['correct-primary','retain-primary'].includes(r.action))throw Error(`Invalid historical resolution ${key}`);
    seen.add(key);
    const supported=new Set(r.sources?.filter(s=>s.name!=='Yahoo Finance'&&corroborates(s.value,r.acceptedClose)).map(s=>s.name));
    if(supported.size<2)throw Error(`${key}: requires two corroborating sources`);
    for(const [field,value]of Object.entries(r.acceptedFields||{close:r.acceptedClose})) {
      if(!['open','high','low','close'].includes(field)||!(value>0)||!(r.originalPrimaryFields?.[field]>0))throw Error(`${key}: invalid reviewed ${field}`);
      const sources=new Set(r.sources.filter(s=>s.name!=='Yahoo Finance'&&corroborates(field==='close'?s.value:s.bar?.[field],value)).map(s=>s.name));
      if(sources.size<2)throw Error(`${key}: ${field} requires two corroborating sources`);
    }
  }
  return evidence;
}

export function resolutionScale(raw,record) {
  const zone=raw.meta?.exchangeTimezoneName||'America/New_York';
  const quote=raw.indicators.quote[0];let last=raw.timestamp.length-1;while(last>=0&&!(quote.close[last]>0))last--;
  const latest=last>=0?tradingDate(raw.timestamp[last],zone):record.basisThrough;
  return Object.values(raw.events?.splits||{}).filter(s=>tradingDate(s.date,zone)>record.basisThrough&&tradingDate(s.date,zone)<=latest)
    .reduce((scale,s)=>{if(!(s.numerator>0&&s.denominator>0))throw Error('Invalid future split');return scale*s.denominator/s.numerator;},1);
}

export function reconcileRaw(input,records,{reviewedAt}={}) {
  const raw=structuredClone(input),q=raw.indicators.quote[0],a=raw.indicators.adjclose?.[0]?.adjclose;
  if(!a)throw Error('Adjusted-close history is required for a historical correction');
  const zone=raw.meta?.exchangeTimezoneName||'America/New_York';
  const dates=raw.timestamp.map(t=>tradingDate(t,zone));
  const prior=raw.historicalReconciliations||[];const checks=[];
  for(const record of records) {
    if(raw.meta?.currency&&raw.meta.currency!==record.currency)throw Error(`${record.id}: price currency changed`);
    if(raw.meta?.symbol&&raw.meta.symbol!==record.id)throw Error(`${record.id}: security symbol changed`);
    const i=dates.indexOf(record.date),scale=resolutionScale(raw,record),target=record.acceptedClose*scale;
    if(i<0||!(q.close[i]>0)||!(a[i]>0))throw Error(`${record.id} ${record.date}: reviewed historical bar is missing`);
    const price=q.close[i],old=prior.find(p=>p.date===record.date);
    const fields=Object.fromEntries(Object.entries(record.acceptedFields||{close:record.acceptedClose}).map(([k,v])=>[k,v*scale]));
    const originalFields=record.originalPrimaryFields||{close:record.originalPrimaryClose};
    const sourceFields={};const pending={};
    for(const [field,value]of Object.entries(fields)) {
      const observed=q[field][i],oldField=old?.fields?.[field]??(field==='close'?old?.close:undefined);
      sourceFields[field]=old&&near(observed,oldField*scale/old.scale)?(old.sourceFields?.[field]??old.sourceClose)*scale/old.scale:observed;
      if(near(observed,value))continue;
      const expectedField=originalFields[field]*scale;
      if(record.action!=='correct-primary'||!near(observed,expectedField))throw Error(`${record.id} ${record.date}: unreviewed Yahoo ${field} ${observed}; expected ${expectedField} or ${value}`);
      pending[field]=value;
    }
    const changes=Object.keys(pending).length>0;
    const status=(changes||old?.status==='corrected')?'corrected':record.action==='retain-primary'?'retained':'vendor-correct';
    if(changes) {
      const after=Object.fromEntries(['open','high','low','close'].map(k=>[k,pending[k]??q[k][i]]));
      const margin=Math.max(1e-5,Math.abs(target)*1e-7);
      if(after.high+margin<Math.max(after.open,after.close)||after.low-margin>Math.min(after.open,after.close))throw Error(`${record.id} ${record.date}: corrected close is outside the recorded high/low; further OHLC review required`);
      for(const [field,value]of Object.entries(pending))q[field][i]=value;
    }
    if(pending.close!=null) {
      const adjustment=a[i]/price;
      a[i]=target*adjustment;
      // If this was the close before an ex-dividend day, the earlier adjustment
      // factors must change as well. Conserve the cash dividend rather than
      // introducing an artificial return into the existing adjusted history.
      const next=dates.findIndex((d,j)=>j>i&&q.close[j]>0);
      const dividend=Object.values(raw.events?.dividends||{}).filter(e=>next>=0&&tradingDate(e.date,zone)===dates[next]).reduce((s,e)=>s+e.amount,0);
      if(dividend) {
        if(!(price>dividend&&target>dividend))throw Error('Invalid ex-dividend correction basis');
        const ratio=(1-dividend/target)/(1-dividend/price);
        for(let j=0;j<=i;j++)if(a[j]>0)a[j]*=ratio;
      }
    }
    checks.push({id:record.id,date:record.date,action:record.action,status,sourceClose:sourceFields.close,close:target,sourceFields,fields,scale,reviewedAt});
  }
  raw.historicalReconciliations=checks;
  return {raw,checks};
}

export function classifyDisagreement({id,date,sourceClose,canonicalClose,secondaryClose,raw,evidence}) {
  const record=evidence.records.find(r=>r.id===id&&r.date===date);
  if(!record)return null;
  const scale=resolutionScale(raw,record),target=record.acceptedClose*scale;
  if(!near(canonicalClose,target))return null;
  if(record.action==='correct-primary'&&near(sourceClose,record.originalPrimaryClose*scale)&&corroborates(secondaryClose,target))
    return {status:'primary-corrected',acceptedClose:target,reviewedAt:evidence.reviewedAt};
  if(record.action==='retain-primary'&&near(sourceClose,target)&&corroborates(secondaryClose,record.originalSecondaryClose*scale))
    return {status:'secondary-record-reviewed',acceptedClose:target,reviewedAt:evidence.reviewedAt};
  return null;
}

export function reconcileHistory({rawDir=RAW_DIR,evidence=loadResolutions()}={}) {
  const checks=[],staged=[];
  for(const id of new Set(evidence.records.map(r=>r.id))) {
    const file=new URL(fileFor(CHAINS[id].at(-1)),rawDir);
    const envelope=JSON.parse(fs.readFileSync(file,'utf8'));
    const result=reconcileRaw(envelope.chart.result[0],evidence.records.filter(r=>r.id===id),{reviewedAt:evidence.reviewedAt});
    staged.push([file,JSON.stringify({...envelope,chart:{...envelope.chart,result:[result.raw]}})]);
    checks.push(...result.checks);
  }
  // Validate every affected security before replacing any raw file.
  for(const [file,body] of staged)fs.writeFileSync(file,body);
  return {reviewedCases:evidence.records.length,primaryCorrectionCases:evidence.records.filter(r=>r.action==='correct-primary').length,
    retainedPrimaryCases:evidence.records.filter(r=>r.action==='retain-primary').length,checks};
}
