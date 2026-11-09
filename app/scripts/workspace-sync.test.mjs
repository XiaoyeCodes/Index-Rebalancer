import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeBook, localBook } from '../workspace-sync.js';
const empty=()=>({state:{},templates:{}});
test('independent settings and templates merge without re-creating deleted templates',()=>{
  const base=empty();base.templates.old={name:'旧模型'};
  const mine={state:{monthly:900},templates:{mine:{name:'甲'}}};
  const theirs={state:{fee:0.1},templates:{...base.templates,theirs:{name:'乙'}}};
  const {book,conflicts}=mergeBook(base,mine,theirs);
  assert.deepEqual(conflicts,[]);assert.deepEqual(book.state,{monthly:900,fee:0.1});assert.deepEqual(Object.keys(book.templates).sort(),['mine','theirs']);
});
test('competing confirmations never split a receipt and its holdings',()=>{
  const base=empty(),mine=empty(),theirs=empty();
  mine.state={holdings:{SPY:2},ledger:{revision:'one'},monthly:800};
  theirs.state={holdings:{SPY:3},ledger:{revision:'two'},fee:1};
  assert.deepEqual(mergeBook(base,mine,theirs).conflicts,['持仓与交易记录']);
  assert.deepEqual(mergeBook(base,mine,theirs,'mine').book.state,{...mine.state,fee:1});
  assert.deepEqual(mergeBook(base,mine,theirs,'theirs').book.state,{...theirs.state,monthly:800});
});
test('workspace publication includes only the investment data allowlist',()=>{
  const data={'heng.state':JSON.stringify({monthly:3000,apiKey:'local-secret',other:'private'}),'heng.templates':'[]','heng.assistant.web.session.xyz':'private conversation'};
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:k=>data[k]}});
  try { assert.deepEqual(localBook(),{state:{monthly:3000},templates:{}}); } finally {delete globalThis.localStorage;}
});
