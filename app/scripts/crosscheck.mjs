// A second feed checks recent, same-date UNADJUSTED closing prices. This does not
// claim independent verification of every historical dividend-adjustment factor.
import fs from 'node:fs';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {CHAINS,RAW_DIR,fileFor} from './assets.mjs';
import {tradingDate,isClosed} from './process.mjs';
const run = promisify(execFile);
export async function requestJSON(url) {
  let error;
  for(let attempt=0;attempt<3;attempt++) try {
    const {stdout} = await run('curl',['-f','-sS','-L','-m','25','-A','Mozilla/5.0','-H','Accept: application/json','-H','Referer: https://www.nasdaq.com/',url],{maxBuffer:4*1024*1024});
    return JSON.parse(stdout);
  } catch(e) {error=e;}
  throw error;
}
export function compareCloses(primary, secondary, tolerance) {
  if(!primary.length) throw new Error('missing primary closing dates');
  const matched = primary.map(p=>({primary:p,secondary:secondary.find(s=>s.date===p.date)}));
  if(matched.some(p=>!p.secondary)) throw new Error('secondary feed is missing a required closing date');
  const differences = matched.map(({primary:p,secondary:s})=>({date:p.date,primary:p.close,secondary:s.close,difference:Math.abs(p.close-s.close)}));
  if(differences.some(p=>p.difference>tolerance)) throw new Error('closing-price disagreement: '+JSON.stringify(differences));
  return differences;
}
export async function crosscheck(data, {rawDir=RAW_DIR,request=requestJSON,now=Date.now()}={}) {
  const entries = Object.entries(CHAINS), results = [], failures = [];
  let cursor=0;
  const worker=async()=>{
    while(cursor<entries.length) {
      const [id,chain]=entries[cursor++],ticker=chain.at(-1);
      try {
        const raw=JSON.parse(fs.readFileSync(new URL(fileFor(ticker),rawDir))).chart.result[0];
        const close=raw.indicators.quote[0].close;
        const primary=raw.timestamp.map((ts,i)=>({date:tradingDate(ts,raw.meta.exchangeTimezoneName),close:close[i],ts}))
          .filter(p=>p.close>0&&p.date<=data.asOf&&isClosed(p.ts,raw.meta,now)).slice(-3);
        let source,url,secondary;
        if(/\.(SS|SZ|HK)$/.test(ticker)) {
          const code=ticker.endsWith('.HK')?'hk'+ticker.split('.')[0].padStart(5,'0'):(ticker.endsWith('.SZ')?'sz':'sh')+ticker.split('.')[0];
          source='Tencent Finance';url=`https://web.ifzq.gtimg.cn/appstock/app/kline/kline?param=${code},day,,,20`;
          const response=await request(url);
          secondary=(response.data?.[code]?.day||[]).map(row=>({date:row[0],close:+row[2]}));
        } else {
          source='Nasdaq';
          const symbol=ticker==='BRK-B'?'BRK.B':ticker;
          const assetclass=['NVDA','MSFT','TSLA','AAPL','AMZN','SPCX','AXP','BRK-B','GOOG'].includes(id)?'stocks':'etf';
          url=`https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/historical?assetclass=${assetclass}&limit=10&fromdate=${primary[0].date}&todate=${data.asOf}`;
          const response=await request(url);
          secondary=(response.data?.tradesTable?.rows||[]).map(row=>({date:new Date(row.date+' 00:00:00 UTC').toISOString().slice(0,10),close:+row.close.replace(/[$,]/g,'')}));
        }
        // Listed US/HK prices are quoted to cents; mainland ETFs to 0.001 yuan.
        const tolerance=id==='SSE'?.006:/\.(SS|SZ|HK)$/.test(ticker)?.00051:.011;
        const observations=compareCloses(primary,secondary,tolerance);
        const secondaryLast=secondary.filter(p=>p.date<=data.asOf&&p.close>0).sort((a,b)=>a.date.localeCompare(b.date)).at(-1)?.date;
        if(secondaryLast>primary.at(-1).date)throw Error(`primary closes stop at ${primary.at(-1).date}; second feed has ${secondaryLast}`);
        results.push({id,ticker,source,url,tolerance,observations});
      } catch(e) {failures.push(`${id}: ${e.message}`);}
    }
  };
  await Promise.all(Array.from({length:4},worker));
  if(failures.length) throw new Error('Cross-source verification failed:\n'+failures.join('\n'));
  return {checkedAt:new Date(now).toISOString(),asOf:data.asOf,assets:results.length,observations:results.reduce((n,r)=>n+r.observations.length,0),results:results.sort((a,b)=>a.id.localeCompare(b.id))};
}
if(process.argv[1] && fileURLToPath(import.meta.url)===fs.realpathSync(process.argv[1])) {
  try {
    const data=JSON.parse(fs.readFileSync(new URL('../data/prices-weekly.json',import.meta.url)));
    const result=await crosscheck(data);
    const target=process.argv[2]||'.private/audit/crosscheck.json';
    fs.writeFileSync(target,JSON.stringify(result,null,2));
    console.log(`Verified ${result.assets} assets / ${result.observations} dated closes through ${result.asOf}: ${target}`);
  } catch(e) {console.error(e.message);process.exitCode=1;}
}
