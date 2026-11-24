import test from 'node:test';
import assert from 'node:assert/strict';
import {loginTransport} from '../login-transport.js';

const endpoint='https://account.example/workspace';
const timeout=()=>new DOMException('signal timed out','TimeoutError');

test('one submission uses the same attempt and body when its connection drops',async()=>{
  const bodies=[];
  const request=loginTransport(endpoint,async(url,options)=>{
    assert.equal(url.href,'https://account.example/auth/login/v2');
    assert.equal(options.method,'POST');
    bodies.push(options.body);
    if (bodies.length===1) throw timeout();
    return Response.json({ok:true});
  });
  let retries=0;
  assert.deepEqual(await request('login/v2',{body:{proof:'fixture'},onRetry:()=>retries++}),{ok:true});
  assert.equal(retries,1);
  assert.equal(bodies.length,2);
  assert.equal(bodies[1],bodies[0]);
  assert.ok(JSON.parse(bodies[0]).attemptId);
  await request('login/v2',{body:{proof:'fixture'}});
  assert.notEqual(bodies[2],bodies[0]);
});

test('unversioned password submissions are never replayed, including a timeout reading the body',async()=>{
  for (const fail of [()=>{throw timeout();},()=>({ok:true,json:async()=>{throw timeout();}})]) {
    let calls=0;
    const request=loginTransport(endpoint,()=>{calls++; return fail();});
    await assert.rejects(request('login',{body:{proof:'fixture'}}), /网络或代理/);
    assert.equal(calls,1);
  }
});

test('restoring a session retries a temporary outage but never retries a rejection',async()=>{
  let calls=0;
  const request=loginTransport(endpoint,async()=>++calls===1
    ? new Response(null,{status:503}) : Response.json({detail:'登录已过期'},{status:401}));
  await assert.rejects(request('resume',{token:'fixture'}), {status:401,message:'登录已过期'});
  assert.equal(calls,2);
  const limited=loginTransport(endpoint,async()=>Response.json({detail:'冷却中',retryAfter:400},{status:429}));
  await assert.rejects(limited('login/v2',{body:{}}),{status:429,retryAfter:400});
});
