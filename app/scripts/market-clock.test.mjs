import test from 'node:test';
import assert from 'node:assert/strict';
import {clockRequests,runMarketTick,sessionForSlot} from '../../sync/market-clock.js';

const date='2026-11-18',live={asOf:date,fxDates:{CNY:date,HKD:date}};
const at=hm=>Date.parse('2026-11-19T'+hm+':00+08:00');
const requests=(data=live)=>({readSite:async()=>data,dispatch:async()=>{}});

test('the independent clock follows the NYSE cutoff in both time zones and skips holidays',()=>{
  assert.equal(sessionForSlot(at('06:23')),null);
  assert.equal(sessionForSlot(at('06:33')).date,date);
  assert.equal(sessionForSlot(Date.parse('2026-07-08T05:33:00+08:00')).date,'2026-07-07');
  assert.equal(sessionForSlot(Date.parse('2026-11-27T08:13:00+08:00')),null); // Thanksgiving
  assert.equal(sessionForSlot(Date.parse('2026-11-22T10:13:00+08:00')),null);
  assert.equal(sessionForSlot(at('16:03')),null);
});

test('the first check and all three named Beijing slots reach GitHub even on a current day',async()=>{
  const sent=[],io={...requests(),dispatch:async p=>sent.push(p)};
  let state;
  for(const hm of ['06:33','06:43','08:13','08:13','08:03','10:13','12:13'])state=await runMarketTick(state,at(hm),io);
  assert.deepEqual(sent.map(p=>p.scheduled_at),['06:33','08:13','10:13','12:13'].map(hm=>new Date(at(hm)).toISOString()));
  assert.ok(sent.every(p=>p.expected_close===date));
  assert.equal(state.outcome,'dispatch-accepted');
});

test('late quotes, late FX and an unavailable site retry until publication catches up',async()=>{
  for(const readSite of [async()=>({...live,asOf:'2026-11-17'}),async()=>({...live,fxDates:{CNY:date}}),async()=>{throw Error('timeout');}]){
    const io={...requests(),readSite};
    let state=await runMarketTick(null,at('08:13'),io);
    state=await runMarketTick(state,at('08:23'),io);assert.equal(state.outcome,'waiting-for-update');
    state=await runMarketTick(state,at('08:43'),io);assert.equal(state.reason,'still-behind');
    state=await runMarketTick(state,at('08:53'),requests());assert.equal(state.outcome,'website-current');
  }
});

test('an unaccepted wake-up is recorded and retried at the next clock tick',async()=>{
  const before=await runMarketTick(null,at('07:13'),requests());
  const failed=await runMarketTick(before,at('08:13'),{...requests(),dispatch:async()=>{throw Error('HTTP 503');}});
  assert.equal(failed.outcome,'dispatch-failed');assert.equal(failed.lastDispatchAt,before.lastDispatchAt);
  const recovered=await runMarketTick(failed,at('08:23'),requests());
  assert.equal(recovered.outcome,'dispatch-accepted');
});

test('the clock posts a single fixed event to its own private repository and accepts only HTTP 204',async()=>{
  const env={GITHUB_BACKUP_REPOSITORY:'XiaoyeCodes/Index-Rebalancer-Automation',GITHUB_BACKUP_TOKEN:'test-only'};
  const payload={scheduled_at:new Date(at('10:13')).toISOString(),reason:'checkpoint',expected_close:date};
  const calls=[];
  const io=clockRequests(env,async(url,options)=>{calls.push({url,options});return new Response(null,{status:204});});
  await io.dispatch(payload);
  assert.equal(calls[0].url,'https://api.github.com/repos/XiaoyeCodes/Index-Rebalancer-Automation/dispatches');
  assert.deepEqual(JSON.parse(calls[0].options.body),{event_type:'market-close-clock',client_payload:payload});
  assert.equal(calls[0].options.redirect,'manual');
  await assert.rejects(clockRequests(env,async()=>new Response(null,{status:307,headers:{Location:'https://other.example/'}})).dispatch(payload),/HTTP 307/);
  await assert.rejects(clockRequests({...env,GITHUB_BACKUP_REPOSITORY:'other/repo'},()=>assert.fail()).dispatch(payload),/credential/);
  await assert.rejects(clockRequests(env,async()=>new Response(null,{status:403})).dispatch(payload),/HTTP 403/);
});
