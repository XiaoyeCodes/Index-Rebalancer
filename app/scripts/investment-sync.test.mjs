import test from 'node:test';
import assert from 'node:assert/strict';
import {workspaceSync,localBook} from '../workspace-sync.js';
import {InvestmentData} from '../investment-book.js';
const book=()=>({state:{weights:{SPY:100},holdings:{SPY:2},monthly:3000,investmentDay:11,contributionMonth:'2026-11'},templates:{}});
async function fixture({changedRemote=false,conflict=false}={}) {
  const values=new Map([['heng.state',JSON.stringify(book().state)],['heng.templates','[]']]);
  const original=new Map(['fetch','navigator','document','window','localStorage'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  let remote,uploaded,puts=0,applied=0;
  const files=new Map();
  const mocks={localStorage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)},navigator:{},window:{addEventListener(){}},document:{hidden:false,addEventListener(){}},fetch:async(url,options)=>{
    assert.match(options.headers.Authorization,/^Bearer [a-f0-9]{64}$/);
    if(url.endsWith('/backups')&&options.method==='POST'){const body=JSON.parse(options.body);files.set(body.id,body.backup);uploaded=body;return Response.json({id:body.id,commit:'saved'});}
    if(url.includes('/backups/'))return Response.json(files.get(decodeURIComponent(url.split('/backups/')[1])));
    if(options.method==='PUT') {puts++;if(conflict)return Response.json({}, {status:409});const body=JSON.parse(options.body);assert.equal(body.revision,5);remote={revision:6,blob:body.blob};return Response.json({revision:6});}
    return Response.json({...remote,revision:changedRemote?6:remote.revision});
  }};
  for(const [key,value]of Object.entries(mocks))Object.defineProperty(globalThis,key,{configurable:true,value});
  const sync=await workspaceSync('https://sync.test/workspace',new Uint8Array(32).fill(1));
  const hooks={validate:b=>InvestmentData.validate(b,['SPY']),status(){},apply:b=>{applied++;values.set('heng.state',JSON.stringify(b.state));values.set('heng.templates',JSON.stringify(Object.values(b.templates)));}};
  sync.bind(hooks);sync.close();remote={revision:5,blob:(await sync.exportBackup(book())).blob};values.set('heng.shared.v1',JSON.stringify({revision:5,base:book()}));
  return {sync,values,get uploaded(){return uploaded;},get puts(){return puts;},get applied(){return applied;},hooks,
    cleanup(){sync.close();for(const [key,descriptor]of original)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}};
}
test('a GitHub round trip preserves holdings and the monthly plan using ciphertext only',async()=>{
  const f=await fixture();
  try {
    const result=await f.sync.createBackup(book());
    assert.deepEqual(await f.sync.importBackup(result.backup),book());
    assert.equal(f.uploaded.backup.state,undefined);assert.ok(!JSON.stringify(f.uploaded).includes('holdings'));
    const wrong=await workspaceSync('https://sync.test/workspace',new Uint8Array(32).fill(2));wrong.bind(f.hooks);wrong.close();
    await assert.rejects(wrong.importBackup(result.backup),/无法解密/);
  } finally {f.cleanup();}
});
test('a confirmed replacement advances the cloud revision and installs one complete new book',async()=>{
  const f=await fixture();
  try {
    const next=InvestmentData.clear(book(),'new-epoch');await f.sync.replaceBook(next,book());
    assert.equal(f.puts,1);assert.equal(f.applied,1);assert.deepEqual(localBook(),next);
    assert.deepEqual(JSON.parse(f.values.get('heng.shared.v1')),{revision:6,base:next});
  } finally {f.cleanup();}
});
test('remote changes, competing writes, and local edits cannot be overwritten by clear or restore',async()=>{
  for(const options of [{changedRemote:true},{conflict:true},{}]){
    const f=await fixture(options);
    try {
      const expected=book();if(!Object.keys(options).length)f.values.set('heng.state',JSON.stringify({...expected.state,holdings:{SPY:9}}));
      const before=f.values.get('heng.state');await assert.rejects(f.sync.replaceBook(InvestmentData.clear(expected,'next'),expected),/新数据|已更新|已变化/);
      assert.equal(f.values.get('heng.state'),before);assert.equal(f.applied,0);
    } finally {f.cleanup();}
  }
});
