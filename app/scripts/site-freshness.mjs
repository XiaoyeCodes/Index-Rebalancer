import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import Calendar from '../market-calendar.js';

const site='https://xiaoyecodes.github.io/Index-Rebalancer/';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export function backupPlan(snapshot,live,{now=Date.now(),manual=false,dataSha256,sourceCommit}={}) {
  const expected=Calendar.expectedUSDate(now);
  const fxExpected=[snapshot.asOf,Calendar.expectedFXDate(now)].sort()[0];
  const fxLate=['CNY','HKD'].some(code=>!(snapshot.fxAsOf?.[code]>=fxExpected));
  if(manual||snapshot.asOf<expected||fxLate)return 'update';
  const checked=Date.parse(live?.checkedAt);
  if(live?.asOf>snapshot.asOf&&Number.isFinite(checked))return 'current'; // A concurrent updater published first.
  const localTime=Date.parse(snapshot.health.checkedAt);
  if(live?.asOf===snapshot.asOf){
    if(checked>localTime)return 'current';
    if(checked===localTime&&dataSha256===live.dataSha256&&live.sourceCommit===sourceCommit&&
       ['CNY','HKD'].every(code=>live.fxDates?.[code]===snapshot.fxAsOf[code]))return 'current';
  }
  return 'deploy';
}

async function readPublic(file,version) {
  const url=new URL(file,site);
  if(version)url.searchParams.set('v',version);
  else url.searchParams.set('check',String(Date.now()));
  const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error(file+' returned HTTP '+response.status);
  return response;
}

const readLive=async()=>(await readPublic('data-status.json')).json();

export function shellMatches(html,version) {
  const envelope=html.match(/<script id="access" type="application\/json">([^<]+)<\/script>/);
  return /^[0-9a-f]{64}$/.test(version)&&!!envelope&&JSON.parse(envelope[1]).appVersion===version;
}

const checkShell=async version=>shellMatches(await (await readPublic('')).text(),version);

export async function publishedFilesMatch(manifest) {
  if(!/^[0-9a-f]{64}$/.test(manifest.applicationSha256)||!await checkShell(manifest.applicationSha256))return false;
  const response=await readPublic('application.bin',manifest.applicationSha256);
  return createHash('sha256').update(new Uint8Array(await response.arrayBuffer())).digest('hex')===manifest.applicationSha256;
}

export async function currentPublication(snapshot,bytes,commit) {
  const live=await readLive();
  const hash=createHash('sha256').update(bytes).digest('hex');
  if(live.sourceCommit!==commit||live.dataSha256!==hash||live.checkedAt!==snapshot.health.checkedAt||
     ['CNY','HKD'].some(code=>live.fxDates?.[code]!==snapshot.fxAsOf?.[code])||
     live.asOf!==snapshot.asOf||backupPlan(snapshot,live,{dataSha256:hash,sourceCommit:commit})!=='current')return false;
  return publishedFilesMatch(live);
}

export function matchesDeployment(local,live) {
  return ['asOf','checkedAt','dataSha256','applicationSha256','sourceCommit'].every(key=>typeof local[key]==='string'&&local[key].length>0&&local[key]===live?.[key]);
}

export async function servesDeployment(target) {
  return matchesDeployment(target,await readLive())&&await publishedFilesMatch(target);
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===fs.realpathSync(process.argv[1])){
  if(process.argv.includes('--verify')){
    const target=JSON.parse(fs.readFileSync('dist/data-status.json','utf8'));
    let verified=false;
    for(let attempt=0;attempt<12&&!verified;attempt++){
      if(attempt)await pause(10000);
      try{
        verified=await servesDeployment(target);
      }catch(error){console.warn(error.message);}
    }
    if(!verified)throw Error('Pages did not serve the deployed market snapshot '+target.asOf+' at '+target.sourceCommit);
    console.log('Verified public market snapshot '+target.asOf+' at '+target.sourceCommit);
  }else{
    const bytes=fs.readFileSync('app/data/prices-weekly.json');
    const snapshot=JSON.parse(bytes),dataSha256=createHash('sha256').update(bytes).digest('hex');
    let live;
    try{live=await readLive();}catch(error){console.warn(error.message);}
    const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
    let plan=backupPlan(snapshot,live,{dataSha256,sourceCommit,manual:process.env.FORCE_UPDATE==='true'});
    if(plan==='current'){
      try{if(!await publishedFilesMatch(live))plan='deploy';}
      catch(error){console.warn(error.message);plan='deploy';}
    }
    const message=`Repository close ${snapshot.asOf}, website close ${live?.asOf||'unavailable'}, expected NYSE close ${Calendar.expectedUSDate()}, action ${plan}`;
    console.log(message);
    if(process.env.GITHUB_OUTPUT)fs.appendFileSync(process.env.GITHUB_OUTPUT,'plan='+plan+'\n');
    if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,message+'\n');
  }
}
