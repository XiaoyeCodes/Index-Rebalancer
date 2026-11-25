import {promisify} from 'node:util';
import {execFile} from 'node:child_process';

const runCurl=promisify(execFile),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export const eastmoneyHistoryMirror='33.push2his.eastmoney.com';
const nasdaqStocks=new Set(['NVDA','MSFT','TSLA','AAPL','AMZN','SPCX','AXP','BRK-B','GOOG']);
export function nasdaqHistoryURL(ticker,from,to,limit=10000) {
  const symbol=ticker==='BRK-B'?'BRK.B':ticker;
  return `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/historical?assetclass=${nasdaqStocks.has(ticker)?'stocks':'etf'}&limit=${limit}&fromdate=${from}&todate=${to}`;
}

// Keep the actual response URL with the evidence, including on failover.
export async function requestQuoteResponse(input,request,options) {
  const url=new URL(input);
  let body;
  try {
    body=await request(url.href,options);
  } catch(error) {
    if(url.hostname!=='push2his.eastmoney.com')throw error;
    url.hostname=eastmoneyHistoryMirror;
    return {body:await request(url.href,options),url:url.href};
  }
  const category=url.searchParams.get('assetclass');
  if(url.hostname==='api.nasdaq.com' && ['etf','stocks'].includes(category) &&
      body?.data===null && body.status?.bCodeMessage?.some(message=>message.code===1001)) {
    // Nasdaq can move the same ticker between its two history catalogs.
    url.searchParams.set('assetclass',category==='etf'?'stocks':'etf');
    body=await request(url.href,options);
  }
  return {body,url:url.href};
}

export async function requestJSON(url,{fresh=false,run=runCurl,wait=pause,retryDelays=[2000,6000]}={}) {
  const host=new URL(url).hostname;
  const referer=host.endsWith('.eastmoney.com')?'https://quote.eastmoney.com/':host.endsWith('.gtimg.cn')?'https://gu.qq.com/':host==='quote.cnbc.com'?'https://www.cnbc.com/':'https://www.nasdaq.com/';
  let error;
  for(let attempt=0;attempt<=retryDelays.length;attempt++)try {
    const headers=fresh||attempt?['-H','Cache-Control: no-cache','-H','Pragma: no-cache']:[];
    const {stdout}=await run('curl',['--http1.1','-f','-sS','-L','-m','25','-A','Mozilla/5.0','-H','Accept: application/json','-H',`Referer: ${referer}`,...headers,url],{maxBuffer:4*1024*1024});
    return JSON.parse(stdout);
  }catch(e){error=e;if(attempt<retryDelays.length)await wait(retryDelays[attempt]);}
  throw error;
}
