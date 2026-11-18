import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import Calendar from '../market-calendar.js';

const statusURL='https://xiaoyecodes.github.io/Index-Rebalancer/data-status.json';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export function backupPlan(snapshot,live,{now=Date.now(),manual=false,dataSha256}={}) {
  const expected=Calendar.expectedUSDate(now);
  const fxExpected=[snapshot.asOf,Calendar.expectedFXDate(now)].sort()[0];
  const fxLate=['CNY','HKD'].some(code=>!(snapshot.fxAsOf?.[code]>=fxExpected));
  if(manual||snapshot.asOf<expected||fxLate)return 'update';
  const checked=Date.parse(live?.checkedAt);
  if(live?.asOf>snapshot.asOf&&Number.isFinite(checked))return 'current'; // A concurrent updater published first.
  const localTime=Date.parse(snapshot.health.checkedAt);
  if(live?.asOf===snapshot.asOf&&(checked>localTime||(checked===localTime&&dataSha256===live.dataSha256)))return 'current';
  return 'deploy';
}

async function readLive() {
  const url=new URL(statusURL);url.searchParams.set('check',String(Date.now()));
  const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('Public data status returned HTTP '+response.status);
  return response.json();
}

export function matchesDeployment(local,live) {
  return ['asOf','checkedAt','dataSha256','applicationSha256','sourceCommit'].every(key=>typeof local[key]==='string'&&local[key].length>0&&local[key]===live?.[key]);
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===fs.realpathSync(process.argv[1])){
  if(process.argv.includes('--verify')){
    const target=JSON.parse(fs.readFileSync('dist/data-status.json','utf8'));
    let verified=false;
    for(let attempt=0;attempt<12&&!verified;attempt++){
      if(attempt)await pause(10000);
      try{verified=matchesDeployment(target,await readLive());}catch(error){console.warn(error.message);}
    }
    if(!verified)throw Error('Pages did not serve the deployed market snapshot '+target.asOf+' at '+target.sourceCommit);
    console.log('Verified public market snapshot '+target.asOf+' at '+target.sourceCommit);
  }else{
    const bytes=fs.readFileSync('app/data/prices-weekly.json');
    const snapshot=JSON.parse(bytes),dataSha256=createHash('sha256').update(bytes).digest('hex');
    let live;
    try{live=await readLive();}catch(error){console.warn(error.message);}
    const plan=backupPlan(snapshot,live,{dataSha256,manual:process.env.FORCE_UPDATE==='true'});
    const message=`Repository close ${snapshot.asOf}, website close ${live?.asOf||'unavailable'}, expected NYSE close ${Calendar.expectedUSDate()}, action ${plan}`;
    console.log(message);
    if(process.env.GITHUB_OUTPUT)fs.appendFileSync(process.env.GITHUB_OUTPUT,'plan='+plan+'\n');
    if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,message+'\n');
  }
}
