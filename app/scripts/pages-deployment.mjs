const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

// An unreadable status can belong to a deployment that is still running.
// Only a terminal infrastructure failure permits resubmitting the artifact.
export async function deployPages({submit,readStatus,isPublished,wait=pause,log=console.log,now=Date.now}) {
  const deadline=now()+15*60*1000;
  let nextPublicCheck=now()+60000;
  let deployment,submissions=0;
  let lastStatus='not submitted';
  while(now()<deadline){
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
    if(status!==lastStatus)log('Pages status: '+status);
    lastStatus=status;
    if(status==='succeed')return;
    if(['deployment_failed','deployment_lost'].includes(status)&&submissions<3){
      log(`Pages reported ${status}. Retrying the verified artifact (attempt ${submissions+1}/3).`);
      deployment=null;
      await wait(15000*submissions);
      continue;
    }
    if(['deployment_failed','deployment_lost','deployment_content_failed','deployment_cancelled'].includes(status))throw Error('Pages reported '+status);
    if(isPublished&&now()>=nextPublicCheck){
      try{if(await isPublished()){log('Verified the published artifact while Pages status was pending.');return;}}
      catch(error){log('Public verification will retry: '+error.message);}
      nextPublicCheck=now()+60000;
    }
    await wait(10000);
  }
  throw Error('Pages did not confirm publication within 15 minutes. Last status: '+lastStatus);
}
