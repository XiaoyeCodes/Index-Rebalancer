import test from 'node:test';
import assert from 'node:assert/strict';
import {browserSession} from '../browser-session.js';

const access={iterations:600000,salt:'salt',iv:'iv',sealed:'encrypted-private-key',wrapped:'first-app-key',appIv:'first-app-iv'};
const key=()=>crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['decrypt']);
function memory() {
  let record=null;
  return {read:async()=>structuredClone(record),write:async value=>{record=structuredClone(value);},clear:async()=>{record=null;}};
}

test('a remembered non-exportable key survives a browser-style clone without storing a password',async()=>{
  const storage=memory(),session=browserSession(storage,()=>1000),original=await key();
  await session.save(access,original);
  const restored=await browserSession(storage,()=>2000).load(access),record=await storage.read();
  assert.equal(restored.extractable,false);
  await assert.rejects(crypto.subtle.exportKey('raw',restored),{name:'InvalidAccessException'});
  assert.deepEqual(Object.keys(record).sort(),['createdAt','expiresAt','fingerprint','key','version']);
  assert.equal(record.expiresAt-record.createdAt,30*24*3600000);
  assert.equal(restored.algorithm.name,'AES-GCM');
});

test('daily application publishes keep the login, while password credential changes invalidate it',async()=>{
  const storage=memory(),session=browserSession(storage);
  await session.save(access,await key());
  assert.ok(await session.load({...access,wrapped:'new-app-key',appIv:'new-app-iv',syncEndpoint:'https://example.test'}));
  assert.equal(await session.load({...access,salt:'changed-password-salt'}),null);
  assert.equal(await storage.read(),null);
});

test('the thirty-day deadline is absolute and expired or malformed sessions are removed',async()=>{
  let now=1000;
  const storage=memory(),session=browserSession(storage,()=>now);
  await session.save(access,await key());
  now+=30*24*3600000-1;assert.ok(await session.load(access));
  now++;assert.equal(await session.load(access),null);assert.equal(await storage.read(),null);
  await session.save(access,await key());
  const corrupt=await storage.read();corrupt.expiresAt=Infinity;await storage.write(corrupt);
  assert.equal(await session.load(access),null);
});

test('logout forgets this login, and exportable or unrelated keys cannot be remembered',async()=>{
  const storage=memory(),session=browserSession(storage);
  await session.save(access,await key());await session.clear();assert.equal(await session.load(access),null);
  const exportable=await crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['decrypt']);
  await assert.rejects(session.save(access,exportable));
  assert.equal(await storage.read(),null);
});

test('storage failures are reported instead of claiming that the browser remembered the login',async()=>{
  const failure=Error('quota'),storage={read:async()=>null,write:async()=>{throw failure;},clear:async()=>{}};
  await assert.rejects(browserSession(storage).save(access,await key()),error=>error===failure);
});
