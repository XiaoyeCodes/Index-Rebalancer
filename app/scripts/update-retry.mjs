import fs from 'node:fs';
import {spawn,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../..',import.meta.url));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export function refreshCIWorkspace({env=process.env,workspace=root,run=execFileSync}={}) {
  if(env.GITHUB_ACTIONS!=='true'||!env.GITHUB_WORKSPACE||fs.realpathSync(env.GITHUB_WORKSPACE)!==fs.realpathSync(workspace))throw Error('Checkout refresh is restricted to the exact disposable GitHub Actions workspace');
  // This is never run in the user's local checkout. A failed push/retry must
  // restart from current main rather than accumulating conflicting data commits.
  run('git',['fetch','origin','main'],{cwd:workspace,stdio:'inherit'});
  run('git',['reset','--hard','FETCH_HEAD'],{cwd:workspace,stdio:'inherit'});
}

export async function runWithRetries({attempt,delays=[60000,180000],wait=pause,beforeAttempt=()=>{},log=console.log}={}) {
  if(typeof attempt!=='function')throw Error('An update attempt is required');
  const failures=[];
  for(let index=0;index<=delays.length;index++){
    try{
      if(index)await beforeAttempt(index);
      const result=await attempt(index);
      if(result!==0&&result!==undefined)throw Error(`Update exited with code ${result}`);
      return {attempts:index+1,failures};
    }catch(error){
      failures.push(error.message);
      if(index===delays.length)throw Error(`Market data update failed after ${index+1} complete attempts: ${failures.join(' | ')}`);
      log(`Update attempt ${index+1} failed: ${error.message}. Refreshing the checkout and retrying in ${delays[index]/1000}s.`);
      await wait(delays[index]);
    }
  }
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===fs.realpathSync(process.argv[1])){
  const refresh=process.argv.includes('--refresh-checkout');
  const args=process.argv.slice(2).filter(value=>value!=='--refresh-checkout');
  try{
    if(refresh&&(process.env.GITHUB_ACTIONS!=='true'||!process.env.GITHUB_WORKSPACE||fs.realpathSync(process.env.GITHUB_WORKSPACE)!==fs.realpathSync(root)))throw Error('Refusing to refresh a non-CI checkout');
    const result=await runWithRetries({
      beforeAttempt:()=>{if(refresh)refreshCIWorkspace();},
      attempt:()=>new Promise((resolve,reject)=>{
        const child=spawn(process.execPath,[fileURLToPath(new URL('update.mjs',import.meta.url)),...args],{cwd:root,stdio:'inherit'});
        child.once('error',reject);
        child.once('exit',(code,signal)=>signal?reject(Error(`Update terminated by ${signal}`)):resolve(code));
      }),
    });
    console.log(`UPDATE_ATTEMPTS=${result.attempts}`);
    if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,`\n## Automatic recovery\n\n- Complete update attempts: ${result.attempts}\n- Earlier failed attempts: ${result.failures.length}\n- Final result: all price, adjustment and independent calculation checks passed.\n`);
  }catch(error){console.error(error.message);process.exitCode=1;}
}
