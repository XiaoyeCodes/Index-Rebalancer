const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

// An unreadable status can belong to a deployment that is still running.
// Only a terminal infrastructure failure permits resubmitting the artifact.
export async function deployPages({submit,readStatus,wait=pause,log=console.log}) {
  let deployment,submissions=0;
  for(let poll=0;poll<48;poll++){
    if(!deployment){
      deployment=await submit();
      submissions++;
    }
    let status;
    try {status=await readStatus(deployment);}
    catch(error){
      if(error.status && error.status!==404 && error.status!==429 && error.status<500) throw error;
      status='unavailable';
    }
    if(status==='succeed')return;
    if(['deployment_failed','deployment_lost'].includes(status)&&submissions<3){
      log(`Pages reported ${status}. Retrying the verified artifact (attempt ${submissions+1}/3).`);
      deployment=null;
      await wait(15000*submissions);
      continue;
    }
    if(['deployment_failed','deployment_lost','deployment_content_failed','deployment_cancelled'].includes(status))throw Error('Pages reported '+status);
    await wait(5000);
  }
  throw Error('Timed out waiting for Pages deployment');
}
