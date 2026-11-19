import calendar from '../app/market-calendar.js';

const minute=60_000;
const site='https://xiaoyecodes.github.io/Index-Rebalancer/data-status.json';
const repository='XiaoyeCodes/Index-Rebalancer-Automation';

// The US close most recently due must be yesterday in Beijing. This also
// excludes exchange holidays and handles the change between EST and EDT.
export function sessionForSlot(time) {
  const beijing=new Date(time+8*60*minute),hour=beijing.getUTCHours();
  const yesterday=new Date(+beijing-24*60*minute).toISOString().slice(0,10);
  if(hour<5||hour>=16||calendar.expectedUSDate(time)!==yesterday)return null;
  return {date:yesterday,checkpoint:beijing.getUTCMinutes()===13&&[8,10,12].includes(hour)};
}

export async function runMarketTick(previous,time,{readSite,dispatch}) {
  const slot=sessionForSlot(time),scheduledAt=new Date(time).toISOString();
  if(!slot||previous?.scheduledAt>=scheduledAt)return previous;
  let live;
  try{live=await readSite(time);}catch{/* A failed public read also needs a freshness check. */}
  const expectedFX=[slot.date,calendar.expectedFXDate(time)].sort()[0];
  const current=live?.asOf>=slot.date&&['CNY','HKD'].every(code=>live.fxDates?.[code]>=expectedFX);
  const state={scheduledAt,expectedClose:slot.date,websiteClose:live?.asOf??null,
    lastDispatchAt:previous?.lastDispatchAt??null,lastDispatchFor:previous?.lastDispatchFor??null};
  const first=state.lastDispatchFor!==slot.date;
  const retryDue=time-Date.parse(state.lastDispatchAt)>=30*minute;
  if(first||slot.checkpoint||previous?.outcome==='dispatch-failed'||(!current&&retryDue)){
    const reason=slot.checkpoint?'checkpoint':first?'first-check':'still-behind';
    try{
      await dispatch({scheduled_at:scheduledAt,expected_close:slot.date,reason});
      return {...state,outcome:'dispatch-accepted',reason,lastDispatchAt:scheduledAt,lastDispatchFor:slot.date};
    }catch(error){
      return {...state,outcome:'dispatch-failed',reason,error:error.message};
    }
  }
  return {...state,outcome:current?'website-current':'waiting-for-update'};
}

export function clockRequests(env,fetcher=fetch) {
  return {
    async readSite(time){
      const response=await fetcher(site+'?clock='+time,{cache:'no-store',signal:AbortSignal.timeout(7000)});
      if(!response.ok)throw Error('Website status HTTP '+response.status);
      return response.json();
    },
    async dispatch(payload){
      // Use the existing server-side Contents grant only against its configured
      // automation repository. No credentials or destinations come from HTTP.
      if(env.GITHUB_BACKUP_REPOSITORY!==repository||!env.GITHUB_BACKUP_TOKEN)throw Error('Automation repository credential unavailable');
      let response;
      try{
        response=await fetcher('https://api.github.com/repos/'+repository+'/dispatches',{
          method:'POST',redirect:'manual',signal:AbortSignal.timeout(9000),
          headers:{Authorization:'Bearer '+env.GITHUB_BACKUP_TOKEN,'User-Agent':'Index-Rebalancer-Market-Clock',
            Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},
          body:JSON.stringify({event_type:'market-close-clock',client_payload:payload})
        });
      }catch{throw Error('Automation repository unreachable');}
      if(response.status!==204)throw Error('Repository dispatch HTTP '+response.status);
    }
  };
}
