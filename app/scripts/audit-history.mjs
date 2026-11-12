// Broader point-by-point quote audit; Nasdaq supplies approximately ten years.
// Dividends/adjusted total returns are a separate calculation, not exchange closes.
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {CHAINS,RAW_DIR,fileFor} from './assets.mjs';
import {tradingDate} from './process.mjs';
import {requestJSON} from './crosscheck.mjs';
export async function auditHistory(data,{request=requestJSON,rawDir=RAW_DIR}={}) {
  const entries=Object.entries(CHAINS).filter(([,c])=>! /\.(SS|SZ|HK)$/.test(c.at(-1))),results=[],failures=[];
  let cursor=0;
  async function worker() {
    while(cursor<entries.length) {
      const [id,c]=entries[cursor++],ticker=c.at(-1);
      try {
        const raw=JSON.parse(fs.readFileSync(new URL(fileFor(ticker),rawDir))).chart.result[0],q=raw.indicators.quote[0].close;
        const primary=new Map(raw.timestamp.map((t,i)=>[tradingDate(t,raw.meta.exchangeTimezoneName),q[i]]));
        const symbol=ticker==='BRK-B'?'BRK.B':ticker,assetclass=['NVDA','MSFT','TSLA','AAPL','AMZN','SPCX','AXP','BRK-B','GOOG'].includes(id)?'stocks':'etf';
        const url=`https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/historical?assetclass=${assetclass}&limit=10000&fromdate=2000-01-01&todate=${data.asOf}`;
        const response=await request(url),rows=response.data?.tradesTable?.rows||[];
        if(!rows.length)throw Error('no exchange history');
        const differences=[],missing=[],weeklyDifferences=[],weekDates=new Set(data.dates);let compared=0,maxDifference=0,weeklyComparisons=0;
        for(const row of rows) {
          const date=new Date(row.date+' 00:00:00 UTC').toISOString().slice(0,10),secondary=+row.close.replace(/[$,]/g,''),first=primary.get(date);
          if(!(first>0)) {missing.push(date);continue;}
          const difference=Math.abs(first-secondary);compared++;maxDifference=Math.max(maxDifference,difference);
          if(weekDates.has(date)){weeklyComparisons++;if(difference>.011)weeklyDifferences.push({date,yahoo:first,nasdaq:secondary,difference});}
          if(difference>.011)differences.push({date,yahoo:first,nasdaq:secondary,difference});
        }
        results.push({id,source:'Nasdaq',url,from:new Date(rows.at(-1).date+' 00:00:00 UTC').toISOString().slice(0,10),to:data.asOf,compared,maxDifference,differences,missing,weeklyComparisons,weeklyDifferences});
      } catch(e){failures.push({id,error:e.message});}
    }
  }
  await Promise.all(Array.from({length:4},worker));
  return {checkedAt:new Date().toISOString(),asOf:data.asOf,assets:results.length,observations:results.reduce((s,r)=>s+r.compared,0),weeklyComparisons:results.reduce((s,r)=>s+r.weeklyComparisons,0),nonWeeklyDisagreements:results.reduce((s,r)=>s+r.differences.length-r.weeklyDifferences.length,0),failures,results:results.sort((a,b)=>a.id.localeCompare(b.id))};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===fs.realpathSync(process.argv[1])) {
  const data=JSON.parse(fs.readFileSync(new URL('../data/prices-weekly.json',import.meta.url)));
  const result=await auditHistory(data);
  fs.writeFileSync(process.argv[2]||'.private/audit/historical-quotes.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify({...result,results:result.results.map(({id,compared,maxDifference,differences,missing})=>({id,compared,maxDifference,disagreements:differences.length,missing:missing.length}))},null,2));
}
