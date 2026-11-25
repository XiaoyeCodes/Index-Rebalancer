import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {currentPublication} from './site-freshness.mjs';

// One ref shared by the private updater, public catch-up and Pages publisher.
// Its empty trees contain no website or account data. Only transitions write it.
const ref='refs/heads/automation/market-alert-state';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const initial={open:false,verifiedAt:0,checkedAt:0};

export function marketTransition(state,event) {
  if(event.stage==='verified'){
    if(!state.open&&event.checkedAt<=state.checkedAt)return {result:'healthy'};
    if(event.at<state.openedAt||event.checkedAt<(state.dataSince||0))return {result:'pending'};
    return {result:state.open?'recovered':'healthy',next:{open:false,verifiedAt:event.at,checkedAt:event.checkedAt}};
  }
  if(event.started<= (event.stage==='data'?state.checkedAt:state.verifiedAt))return {result:'superseded'};
  if(state.open){
    const result=state.owner===event.owner?'alert':'pending';
    // A later deployment must also cover any outstanding data failure.
    if(event.stage==='data'&&event.started>(state.dataSince||0))return {result,next:{...state,dataSince:event.started}};
    return {result};
  }
  return {result:'alert',next:{...state,open:true,owner:event.owner,openedAt:event.at,stage:event.stage,
    dataSince:event.stage==='data'?event.started:0}};
}

export async function recordMarketEvent(event,{cwd=process.cwd(),verify,wait=pause}={}) {
  const git=(args,input)=>execFileSync('git',args,{cwd,encoding:'utf8',input,stdio:['pipe','pipe','pipe']}).trim();
  let verified=false;
  for(let attempt=0;;attempt++){
    try {
      let previous,state=initial;
      if(git(['ls-remote','--refs','origin',ref])){
        git(['fetch','--quiet','--no-tags','--depth=1','origin',ref]);
        previous=git(['rev-parse','FETCH_HEAD']);
        state=JSON.parse(git(['show','-s','--format=%B',previous]));
        if(typeof state.open!=='boolean'||!Number.isFinite(state.checkedAt)||!Number.isFinite(state.verifiedAt))throw Error('Invalid market incident state');
      }
      const {next,result}=marketTransition(state,event);
      if(!next)return result;
      if(event.stage==='verified'&&!verified){
        if(!await verify())return state.open?'pending':'waiting';
        verified=true;
      }
      const tree=git(['mktree'],'');
      const commit=git(['-c','user.name=Market update monitor','-c','user.email=github-actions[bot]@users.noreply.github.com',
        'commit-tree',tree,...(previous?['-p',previous]:[])],JSON.stringify(next)+'\n');
      // Fast-forward only. A simultaneous claimant must read the winner before notifying.
      git(['push','--quiet','origin',commit+':'+ref]);
      return result;
    } catch(error) {
      if(attempt===3)throw error;
      await wait(1000*2**attempt);
    }
  }
}

async function main(){
  const stage=process.argv[2],at=Date.now();
  if(process.env.GITHUB_ACTIONS!=='true'||!['data','pages','verified'].includes(stage))throw Error('Expected an Actions market incident event');
  const bytes=fs.readFileSync('app/data/prices-weekly.json'),snapshot=JSON.parse(bytes);
  const started=Number(process.env.MARKET_STARTED_AT);
  if(stage!=='verified'&&!(started>0&&started<=at))throw Error('Missing start time for the failed attempt');
  const event={stage,started,at,owner:randomUUID(),checkedAt:Date.parse(snapshot.health.checkedAt)};
  const result=await recordMarketEvent(event,{verify:async()=>{
    const commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
    const main=execFileSync('git',['ls-remote','origin','refs/heads/main'],{encoding:'utf8'}).split(/\s/)[0];
    if(main!==commit)return false;
    try{return await currentPublication(snapshot,bytes,commit);}
    catch(error){console.warn('Public verification pending:',error.message);return false;}
  }});
  const messages={
    alert:'本轮重试已耗尽，首次报告这次行情更新或发布故障。后续定时任务会继续补跑。',
    pending:'故障仍在跟踪，等待下轮自动重试或线上核验。详细原因见本轮任务日志。',
    superseded:'较新的成功核验已经覆盖这次旧任务。',
    waiting:'仍在等待当前版本的线上核验。',
    recovered:'最新行情和线上应用已核验，本次故障已恢复。',
    healthy:'当前没有待恢复的行情故障。'
  };
  const message=messages[result];
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,'\n'+message+'\n');
  console.log((result==='pending'?'::warning::':result==='alert'?'::error::':'')+message);
  if(result==='alert')process.exitCode=1;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===fs.realpathSync(process.argv[1]))await main();
