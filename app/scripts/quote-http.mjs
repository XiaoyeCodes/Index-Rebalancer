import {promisify} from 'node:util';
import {execFile} from 'node:child_process';

const runCurl=promisify(execFile),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function requestJSON(url,{fresh=false,run=runCurl,wait=pause,retryDelays=[2000,6000]}={}) {
  const host=new URL(url).hostname;
  const referer=host.endsWith('.eastmoney.com')?'https://quote.eastmoney.com/':host.endsWith('.gtimg.cn')?'https://gu.qq.com/':'https://www.nasdaq.com/';
  let error;
  for(let attempt=0;attempt<=retryDelays.length;attempt++)try {
    const headers=fresh||attempt?['-H','Cache-Control: no-cache','-H','Pragma: no-cache']:[];
    const {stdout}=await run('curl',['--http1.1','-f','-sS','-L','-m','25','-A','Mozilla/5.0','-H','Accept: application/json','-H',`Referer: ${referer}`,...headers,url],{maxBuffer:4*1024*1024});
    return JSON.parse(stdout);
  }catch(e){error=e;if(attempt<retryDelays.length)await wait(retryDelays[attempt]);}
  throw error;
}
