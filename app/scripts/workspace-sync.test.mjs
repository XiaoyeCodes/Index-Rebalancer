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

test('reset grants and their consumed receipts merge as one portfolio change',()=>{
  const base={state:{holdings:{SPY:1},ledger:{entries:[]},investmentResets:{monthly:{id:'grant',period:'2026-11'}}},templates:{}};
  const mine=structuredClone(base),theirs=structuredClone(base);
  mine.state.holdings.SPY=2;
  mine.state.ledger.entries.push({investmentType:'monthly',operationId:'monthly:2026-11:reset:grant',resetId:'grant'});
  theirs.state.investmentResets.rebalance={id:'other-grant',period:'2026-11'};
  assert.deepEqual(mergeBook(base,mine,theirs).conflicts,['持仓与交易记录']);
  assert.deepEqual(mergeBook(base,mine,theirs,'mine').book.state,mine.state);
  assert.deepEqual(mergeBook(base,mine,theirs,'theirs').book.state,theirs.state);
});

test('workspace publication preserves reset grants together with the balance-check date',()=>{
  const state={lastBalanceCheckDate:'2026-11-09',investmentResets:{rebalance:{id:'pending',period:'2026-11'}},apiKey:'private'};
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>key==='heng.state'?JSON.stringify(state):'[]'}});
  try {assert.deepEqual(localBook().state,{lastBalanceCheckDate:state.lastBalanceCheckDate,investmentResets:state.investmentResets});}finally{delete globalThis.localStorage;}
});
