// A Yahoo null bar is not a zero return. Fill only holes, only after two other
// feeds agree on same-date OHLC. Retain the evidence so later fetches cannot
// silently reintroduce previously verified holes.
import fs from 'node:fs';
import {CHAINS,RAW_DIR,fileFor} from './assets.mjs';
import {tradingDate,isClosed} from './process.mjs';
import {requestJSON} from './crosscheck.mjs';
export async function repairQuotes({archive=[],rawDir=RAW_DIR,request=requestJSON,now=Date.now()}={}) {
  const spy=JSON.parse(fs.readFileSync(new URL(fileFor('SPY'),rawDir))).chart.result[0];
  const cutoff=spy.timestamp.map((t,i)=>({t,c:spy.indicators.quote[0].close[i]})).filter(p=>p.c>0&&isClosed(p.t,spy.meta,now)).at(-1);
  const asOf=tradingDate(cutoff.t,spy.meta.exchangeTimezoneName);
  const evidence=[...archive],applied=[];
  for(const [id,chain] of Object.entries(CHAINS)) {
    const ticker=chain.at(-1);
    if(!/\.(SS|SZ|HK)$/.test(ticker))continue;
    const file=new URL(fileFor(ticker),rawDir),envelope=JSON.parse(fs.readFileSync(file)),r=envelope.chart.result[0],q=r.indicators.quote[0],a=r.indicators.adjclose[0].adjclose;
    for(const record of r.verifiedRepairs||[])if(!evidence.some(p=>p.ticker===ticker&&p.date===record.date))evidence.push(record);
    const dates=r.timestamp.map(t=>tradingDate(t,r.meta.exchangeTimezoneName));
    const missing=dates.map((d,i)=>({d,i})).filter(({d,i})=>d<=asOf&&!(q.close[i]>0));
    if(!missing.length)continue;
    let dirty=false;
    const put=(i,record)=>{for(const k of ['open','high','low','close'])q[k][i]=record.ohlc[k];dirty=true;applied.push({id,date:record.date,sources:record.sources});};
    for(const {d,i}of missing) {const old=evidence.find(p=>p.ticker===ticker&&p.date===d);if(old)put(i,old);}
    const recent=missing.filter(({d,i})=>!(q.close[i]>0)&&(Date.parse(asOf)-Date.parse(d))/864e5<=20);
    if(recent.length) {
      const code=ticker.endsWith('.HK')?'hk'+ticker.split('.')[0].padStart(5,'0'):(ticker.endsWith('.SZ')?'sz':'sh')+ticker.split('.')[0];
      const first=`https://web.ifzq.gtimg.cn/appstock/app/kline/kline?param=${code},day,,,30`;
      const market=ticker.endsWith('.HK')?'116':ticker.endsWith('.SZ')?'0':'1';
      const second=`https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${market}.${ticker.endsWith('.HK')?ticker.split('.')[0].padStart(5,'0'):ticker.split('.')[0]}&klt=101&fqt=0&beg=${recent[0].d.replaceAll('-','')}&end=${asOf.replaceAll('-','')}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56`;
      const [tencent,eastmoney]=await Promise.all([request(first),request(second)]);
      const tRows=tencent.data?.[code]?.day||[],eRows=(eastmoney.data?.klines||[]).map(row=>row.split(','));
      for(const {d,i}of recent) {
        const x=tRows.find(v=>v[0]===d),y=eRows.find(v=>v[0]===d);
        if(!x&&!y)continue; // actual non-trading day; never fabricate a bar
        if(!x||!y)throw Error(`${id} ${d}: only one fallback feed has the missing bar`);
        const ohlc={open:+x[1],close:+x[2],high:+x[3],low:+x[4]};
        if(Object.values(ohlc).some(v=>!(v>0))||[1,2,3,4].some(k=>Math.abs(+x[k]-+y[k])>.00051))throw Error(`${id} ${d}: fallback OHLC disagreement`);
        const record={id,ticker,date:d,ohlc,sources:['Tencent Finance','Eastmoney'],urls:[first,second],verifiedAt:new Date(now).toISOString(),reason:'Yahoo daily bar contains null OHLC'};
        evidence.push(record);put(i,record);
      }
    }
    if(dirty) {
      // Infer ONLY the missing adjusted values from the reported cash events.
      // Existing vendor adjusted prices remain intact, including all prior factors.
      const valid=q.close.map((c,i)=>c>0?i:null).filter(i=>i!==null),anchor=[...valid].reverse().find(i=>a[i]>0);
      let factor=a[anchor]/q.close[anchor];
      const dividends=Object.fromEntries(Object.values(r.events?.dividends||{}).map(e=>[tradingDate(e.date,r.meta.exchangeTimezoneName),e.amount]));
      for(let n=valid.indexOf(anchor);n>=0;n--) {
        const i=valid[n];if(!(a[i]>0))a[i]=q.close[i]*factor;
        if(n>0)factor*=1-(dividends[dates[i]]||0)/q.close[valid[n-1]];
      }
      r.verifiedRepairs=evidence.filter(p=>p.ticker===ticker);
      fs.writeFileSync(file,JSON.stringify(envelope));
    }
  }
  return {asOf,evidence,applied};
}
