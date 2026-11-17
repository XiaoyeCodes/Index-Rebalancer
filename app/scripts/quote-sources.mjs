import {createHash} from 'node:crypto';
import {tradingDate} from './process.mjs';
import {requestJSON} from './quote-http.mjs';

export const PRICE_FIELDS=['open','high','low','close'];
export const isAsian=ticker=>/\.(SS|SZ|HK)$/.test(ticker);
export const currencyFor=ticker=>ticker.endsWith('.HK')?'HKD':isAsian(ticker)?'CNY':'USD';
export const toleranceFor=(id,ticker)=>id==='SSE'?.006:isAsian(ticker)?.00051:.011;
export const normalizeSymbol=value=>String(value||'').toUpperCase().replaceAll('-','.').replaceAll('/','.');
export const validBar=bar=>bar&&PRICE_FIELDS.every(key=>Number.isFinite(bar[key])&&bar[key]>0)&&bar.high>=Math.max(bar.open,bar.close)&&bar.low<=Math.min(bar.open,bar.close);
export const samePrice=(a,b,tolerance)=>Number.isFinite(a)&&a>0&&Number.isFinite(b)&&b>0&&Math.abs(a-b)<=tolerance;
export const sameBar=(a,b,tolerance)=>validBar(a)&&validBar(b)&&PRICE_FIELDS.every(key=>samePrice(a[key],b[key],tolerance));
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const number=value=>typeof value==='number'?value:Number(String(value??'').replace(/[$,]/g,''));
const stocks=new Set(['NVDA','MSFT','TSLA','AAPL','AMZN','SPCX','AXP','BRK-B','GOOG']);
const venues={NMS:'OQ',NGM:'OQ',NCM:'OQ',NAS:'OQ',NYQ:'N',NYSE:'N',PCX:'AM',ASE:'AM',BATS:'AM'};

export function splitFactor(raw,date,through) {
  return Object.values(raw.events?.splits||{}).filter(event=>{
    const day=tradingDate(event.date,raw.meta.exchangeTimezoneName);
    return day>date&&day<=through;
  }).reduce((factor,event)=>{
    if(!(event.numerator>0&&event.denominator>0))throw Error('Invalid reported split event');
    return factor*event.denominator/event.numerator;
  },1);
}

export function priceBasisThrough(raw,asOf,now=Date.now()) {
  const today=tradingDate(now/1000,raw.meta.exchangeTimezoneName),quote=raw.indicators.quote[0];
  const latest=raw.timestamp.map((time,index)=>({date:tradingDate(time,raw.meta.exchangeTimezoneName),close:quote.close[index]})).filter(row=>row.date<=today&&row.close>0).at(-1)?.date;
  return [asOf,latest||asOf].sort().at(-1);
}

export function sourceCodes(id,ticker,raw) {
  if(raw.meta.symbol!==ticker||raw.meta.currency!==currencyFor(ticker))throw Error(`${id}: primary security identity/currency mismatch`);
  if(isAsian(ticker))return {tencent:ticker.endsWith('.HK')?'hk'+ticker.split('.')[0].padStart(5,'0'):(ticker.endsWith('.SZ')?'sz':'sh')+ticker.split('.')[0],
    eastmoney:(ticker.endsWith('.HK')?'116':ticker.endsWith('.SZ')?'0':'1')+'.'+(ticker.endsWith('.HK')?ticker.split('.')[0].padStart(5,'0'):ticker.split('.')[0])};
  const venue=venues[raw.meta.exchangeName];
  if(!venue)throw Error(`${id}: unsupported US exchange ${raw.meta.exchangeName}`);
  if(id==='SPCX'&&(raw.meta.instrumentType!=='EQUITY'||!/space\s*(x|exploration)/i.test(raw.meta.longName||raw.meta.shortName||'')))throw Error('SPCX is not the verified SpaceX security');
  return {tencent:'us'+(ticker==='BRK-B'?'BRK.B':ticker)+'.'+venue};
}

// Only actual unadjusted market bars are accepted. Transaction-date bars from
// Tencent/Eastmoney are rescaled by reported, already-effective share splits.
export async function fetchBars({id,ticker,raw,source,from,to,through,request=requestJSON,now=Date.now(),attempt=0}) {
  const codes=sourceCodes(id,ticker,raw),currency=currencyFor(ticker);
  through=through||priceBasisThrough(raw,to,now);
  let url,rows,body;
  if(source==='Nasdaq'){
    const symbol=ticker==='BRK-B'?'BRK.B':ticker;
    url=`https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/historical?assetclass=${stocks.has(id)?'stocks':'etf'}&limit=10000&fromdate=${from}&todate=${to}`;
  }else if(source==='Tencent Finance')url=`https://web.ifzq.gtimg.cn/appstock/app/kline/kline?param=${codes.tencent},day,${from},${to},640`;
  else if(source==='Eastmoney'&&codes.eastmoney)url=`https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${codes.eastmoney}&klt=101&fqt=0&beg=${from.replaceAll('-','')}&end=${to.replaceAll('-','')}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56`;
  else throw Error(`Unsupported quote source ${source} for ${ticker}`);
  const freshUrl=new URL(url);freshUrl.searchParams.set('_',`${now}-${id}-${attempt}`);url=freshUrl.href;
  body=await request(url,{fresh:true});
  if(source==='Nasdaq'){
    if(normalizeSymbol(body.data?.symbol)!==normalizeSymbol(ticker))throw Error(`${id}: Nasdaq security mismatch`);
    const table=body.data?.tradesTable?.rows;
    if(!Array.isArray(table)||!Number.isInteger(body.data.totalRecords)||body.data.totalRecords!==table.length)throw Error(`${id}: incomplete Nasdaq response`);
    rows=table.map(row=>({date:new Date(row.date+' 00:00:00 UTC').toISOString().slice(0,10),...Object.fromEntries(PRICE_FIELDS.map(key=>[key,number(row[key])]))}));
  }else if(source==='Tencent Finance'){
    const detail=body.data?.[codes.tencent],quote=detail?.qt?.[codes.tencent];
    if(!Array.isArray(detail?.day)||!Array.isArray(quote)||quote[2]!==codes.tencent.replace(/^(us|sh|sz|hk)/,''))throw Error(`${id}: Tencent security mismatch`);
    if(currency==='USD'&&!quote.includes('USD'))throw Error(`${id}: Tencent currency mismatch`);
    if(id==='SPCX'&&!quote.some(value=>typeof value==='string'&&/space\s*(x|exploration)/i.test(value)))throw Error('Tencent SPCX issuer mismatch');
    rows=detail.day.map(row=>({date:row[0],open:+row[1],close:+row[2],high:+row[3],low:+row[4]}));
  }else{
    const [market,code]=codes.eastmoney.split('.');
    if(String(body.data?.market)!==market||body.data?.code!==code||!Array.isArray(body.data?.klines))throw Error(`${id}: Eastmoney security mismatch`);
    rows=body.data.klines.map(row=>row.split(',')).map(row=>({date:row[0],open:+row[1],close:+row[2],high:+row[3],low:+row[4]}));
  }
  const seen=new Set(),bars=[];
  for(const row of rows){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(row.date)||seen.has(row.date)||!validBar(row))throw Error(`${id}: invalid/duplicate ${source} bar`);
    seen.add(row.date);
    if(row.date<from||row.date>to)continue;
    const factor=source==='Nasdaq'?1:splitFactor(raw,row.date,through);
    bars.push({...row,...Object.fromEntries(PRICE_FIELDS.map(key=>[key,row[key]*factor])),splitFactor:factor});
  }
  return {name:source,ticker,currency,url,basisThrough:through,checkedAt:new Date(now).toISOString(),sha256:digest(body),bars};
}

export function sourceObservation(feed,date) {
  const bar=feed.bars.find(row=>row.date===date);
  return bar?{name:feed.name,url:feed.url,ticker:feed.ticker,currency:feed.currency,date,value:bar.close,
    bar:Object.fromEntries(PRICE_FIELDS.map(key=>[key,bar[key]])),splitFactor:bar.splitFactor??1,checkedAt:feed.checkedAt,sha256:feed.sha256}:null;
}

export function primaryObservation({ticker,raw,date,index,now=Date.now()}) {
  const quote=raw.indicators.quote[0],review=raw.historicalReconciliations?.find(item=>item.date===date),fill=raw.automaticQuoteFills?.find(item=>item.date===date);
  const canonicalBar=Object.fromEntries(PRICE_FIELDS.map(key=>[key,quote[key]?.[index]??null]));
  const bar=fill?.originalPrimaryFields||{...canonicalBar,...review?.sourceFields};
  return {name:'Yahoo Finance',url:`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`,ticker,currency:raw.meta.currency,
    date,value:bar.close,bar,canonicalBar,checkedAt:new Date(now).toISOString(),sha256:digest({meta:raw.meta.symbol,date,bar})};
}
