// Broader point-by-point quote audit; Nasdaq supplies approximately ten years.
// Dividends/adjusted total returns are a separate calculation, not exchange closes.
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {CHAINS,RAW_DIR,fileFor} from './assets.mjs';
import {tradingDate} from './process.mjs';
import {requestJSON} from './crosscheck.mjs';
import {classifyDisagreement,loadResolutions} from './reconcile-history.mjs';
export async function auditHistory(data,{request=requestJSON,rawDir=RAW_DIR,evidence=loadResolutions()}={}) {
  const entries=Object.entries(CHAINS).filter(([,c])=>! /\.(SS|SZ|HK)$/.test(c.at(-1))),results=[],failures=[];
  let cursor=0;
  async function worker() {
    while(cursor<entries.length) {
      const [id,c]=entries[cursor++],ticker=c.at(-1);
      try {
        const raw=JSON.parse(fs.readFileSync(new URL(fileFor(ticker),rawDir))).chart.result[0],q=raw.indicators.quote[0].close;
        const primary=new Map(raw.timestamp.map((t,i)=>[tradingDate(t,raw.meta.exchangeTimezoneName),q[i]]));
        const original=new Map(primary);
        for(const checked of raw.historicalReconciliations||[])original.set(checked.date,checked.sourceClose);
        const symbol=ticker==='BRK-B'?'BRK.B':ticker,assetclass=['NVDA','MSFT','TSLA','AAPL','AMZN','SPCX','AXP','BRK-B','GOOG'].includes(id)?'stocks':'etf';
        const url=`https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/historical?assetclass=${assetclass}&limit=10000&fromdate=2000-01-01&todate=${data.asOf}`;
        const response=await request(url),rows=response.data?.tradesTable?.rows||[];
        if(!rows.length)throw Error('no exchange history');
        const differences=[],unresolvedDifferences=[],missing=[],weeklyDifferences=[],weekDates=new Set(data.dates);let compared=0,maxDifference=0,weeklyComparisons=0,canonicalDisagreements=0;
        for(const row of rows) {
          const date=new Date(row.date+' 00:00:00 UTC').toISOString().slice(0,10),secondary=+row.close.replace(/[$,]/g,''),first=primary.get(date);
          if(!(first>0)) {missing.push(date);continue;}
          const sourceClose=original.get(date),difference=Math.abs(sourceClose-secondary),canonicalDifference=Math.abs(first-secondary);compared++;maxDifference=Math.max(maxDifference,difference);
          if(weekDates.has(date))weeklyComparisons++;
          if(canonicalDifference>.011)canonicalDisagreements++;
          if(difference>.011||canonicalDifference>.011) {
            const resolution=classifyDisagreement({id,date,sourceClose,canonicalClose:first,secondaryClose:secondary,raw,evidence});
            const item={date,yahoo:sourceClose,nasdaq:secondary,difference,canonicalClose:first,canonicalDifference,...(resolution?{resolution}:{})};
            differences.push(item);
            if(!resolution){unresolvedDifferences.push(item);if(weekDates.has(date))weeklyDifferences.push(item);}
          }
        }
        results.push({id,source:'Nasdaq',url,from:new Date(rows.at(-1).date+' 00:00:00 UTC').toISOString().slice(0,10),to:data.asOf,compared,maxDifference,differences,unresolvedDifferences,canonicalDisagreements,missing,weeklyComparisons,weeklyDifferences,weeklyDisagreements:differences.filter(item=>weekDates.has(item.date)).length});
      } catch(e){failures.push({id,error:e.message});}
    }
  }
  await Promise.all(Array.from({length:4},worker));
  return {checkedAt:new Date().toISOString(),asOf:data.asOf,assets:results.length,observations:results.reduce((s,r)=>s+r.compared,0),weeklyComparisons:results.reduce((s,r)=>s+r.weeklyComparisons,0),nonWeeklyDisagreements:results.reduce((s,r)=>s+r.differences.length-r.weeklyDisagreements,0),sourceDisagreements:results.reduce((s,r)=>s+r.differences.length,0),canonicalVsNasdaqDisagreements:results.reduce((s,r)=>s+r.canonicalDisagreements,0),
    unresolvedDisagreements:results.reduce((s,r)=>s+r.unresolvedDifferences.length,0),reviewedCases:evidence.records.length,primaryCorrectionCases:evidence.records.filter(r=>r.action==='correct-primary').length,retainedPrimaryCases:evidence.records.filter(r=>r.action==='retain-primary').length,
    failures,results:results.sort((a,b)=>a.id.localeCompare(b.id))};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===fs.realpathSync(process.argv[1])) {
  const data=JSON.parse(fs.readFileSync(new URL('../data/prices-weekly.json',import.meta.url)));
  const result=await auditHistory(data);
  fs.writeFileSync(process.argv[2]||'.private/audit/historical-quotes.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify({...result,results:result.results.map(({id,compared,maxDifference,differences,missing})=>({id,compared,maxDifference,disagreements:differences.length,missing:missing.length}))},null,2));
}
