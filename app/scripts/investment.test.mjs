import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const Investment = vm.runInNewContext(readFileSync(new URL('../investment.js', import.meta.url), 'utf8') + '\nInvestment');
const source = readFileSync(new URL('../src.html', import.meta.url), 'utf8');
function plan(kind, options = {}) {
  const state = { weights: { A: 50, B: 50 }, holdings: { A: 8, B: 2 }, monthly: 100, fx: 1, abs: 5, rel: 25, mode: 'hybrid', period: 'Y', cashflow: true, allowSell: true, ...options };
  const intent = { kind, amountCny: kind === 'bonus' ? 150 : null, id: 'bonus-1', period: '2026-11' };
  const ctx = vm.createContext({ S: state, investmentIntent: intent, Investment, todayStr: () => '2026-11-09',
    modelIds: () => Object.keys(state.weights), px: id => id === 'A' ? 123.45 : 234.56, lotOf: () => 1 });
  vm.runInContext('const bandOf = w => Math.min(S.abs/100,S.rel/100*w);' + source.slice(source.indexOf('function planRebalance('), source.indexOf('function marketRead(')), ctx);
  return vm.runInContext('planRebalance()', ctx);
}

test('legacy flags and old monthly contribution entries continue to block a repeated month', () => {
  assert.equal(Investment.monthlyDone({ contributionMonth: '2026-11' }, '2026-11-09'), true);
  assert.equal(Investment.monthlyDone({ contributionMonth: '2026-11' }, '2026-12-01'), false);
  assert.equal(Investment.monthlyDone({ ledger: { entries: [{ kind: '定投与再平衡', date: '2026-11-01', flow: 50 }] } }, '2026-11-09'), true);
  assert.equal(Investment.monthlyDone({ ledger: { entries: [{ kind: '奖金加仓', investmentType: 'bonus', date: '2026-11-01', period: '2026-11', flow: 50 }] } }, '2026-11-09'), false);
});

test('monthly completion is independent of later bonus and rebalance receipts', () => {
  const state = { ledger: { entries: [{ investmentType: 'monthly', period: '2026-11', operationId: 'monthly:2026-11' }, { investmentType: 'bonus', operationId: 'extra-2' }] } };
  assert.equal(Investment.monthlyDone(state, '2026-11-30'), true);
  assert.equal(Investment.monthlyDone(state, '2026-12-01'), false);
  assert.equal(Investment.operationDone(state, { kind: 'bonus', id: 'extra-2' }, '2026-11-30'), true);
  assert.equal(Investment.operationDone(state, { kind: 'bonus', id: 'extra-3' }, '2026-11-30'), false);
});

test('monthly day clamps at month end and handles leap years and December rollover', () => {
  assert.equal(Investment.monthlyDate({investmentDay:31}, '2026-02-01', false), '2026-02-28');
  assert.equal(Investment.monthlyDate({investmentDay:31}, '2028-02-01', false), '2028-02-29');
  assert.equal(Investment.monthlyDate({investmentDay:31,contributionMonth:'2026-12'}, '2026-12-20'), '2027-01-31');
  assert.equal(Investment.monthlyDate({investmentDay:10,mode:'calendar',period:'Y'}, '2026-11-09', true), '2026-12-10');
});

test('monthly and bonus purchases only buy; rebalance has zero contribution', () => {
  const monthly = plan('monthly');
  assert.equal(monthly.A, 100); assert.equal(monthly.sell, 0); assert.equal(monthly.rebalance, false);
  const bonus = plan('bonus', { contributionMonth: '2026-11' });
  assert.equal(bonus.A, 150); assert.equal(bonus.sell, 0); assert.equal(bonus.completed, false);
  const rebalance = plan('rebalance');
  assert.equal(rebalance.A, 0); assert.ok(rebalance.sell > 0);
});

test('completed monthly and bonus operations cannot produce another funded plan', () => {
  assert.equal(plan('monthly', {contributionMonth:'2026-11'}).buy, 0);
  const extra = plan('bonus', {ledger:{entries:[{investmentType:'bonus',operationId:'bonus-1'}]}});
  assert.equal(extra.A, 0); assert.equal(extra.buy, 0); assert.equal(extra.sell, 0);
});

test('fractional and whole-share trades stay inside the contribution and match stored precision', () => {
  for (const wholeShares of [false, true]) for (const monthly of [0.1, 1, 50, 3000, 99999]) {
    const result = plan('monthly', {monthly,wholeShares});
    assert.ok(result.buy <= result.A + 1e-7);
    assert.ok(Math.abs(result.buy + result.leftover - result.A) < 1e-6);
    for (const shares of Object.values(result.shares)) assert.ok(Math.abs(shares*1000 - Math.round(shares*1000)) < 1e-6);
  }
});

test('a monthly or bonus confirmation cannot advance the periodic rebalance schedule', () => {
  const state = {lastAppliedOps:{investmentType:'bonus',confirmedOn:'2026-11-09'},lastExecutionDate:'2026-11-09',lastBalanceCheckDate:'2026-07-01'};
  assert.equal(Investment.lastBalanceCheck(state), '2026-07-01');
  assert.equal(Investment.lastBalanceCheck({lastAppliedOps:{investmentType:'monthly',confirmedOn:'2026-01-01'},lastExecutionDate:'2026-01-01',ledger:{date:'2026-01-01',entries:[]}}, false), undefined);
});

test('rebalance completion survives a new operation id and expires in the next month', () => {
  const state = JSON.parse(JSON.stringify({ledger:{entries:[{investmentType:'rebalance',operationId:'old-check',period:'2026-11',date:'2026-11-09'}]}}));
  assert.equal(Investment.rebalanceDone(state, '2026-11-30'), true);
  assert.equal(Investment.operationDone(state, {kind:'rebalance',id:'new-check'}, '2026-11-30'), true);
  assert.equal(Investment.rebalanceDone(state, '2026-12-01'), false);
  assert.equal(Investment.monthlyDone(state, '2026-11-30'), false);
  assert.equal(Investment.rebalanceDone({lastBalanceCheckDate:'2026-11-09'}, '2026-11-30'), true);
  assert.equal(Investment.rebalanceDone({contributionMonth:'2026-11',lastExecutionDate:'2026-11-09'}, '2026-11-30'), false);
});

function actions(overrides = {}) {
  const state = {weights:{A:50,B:50},holdings:{A:100,B:0},monthly:3000,fx:1,
    mode:'hybrid',abs:5,rel:25,period:'Y',cashflow:true,allowSell:true,...overrides};
  const ctx = vm.createContext({S:state,Investment,todayStr:()=> '2026-11-09',
    modelIds:()=>Object.keys(state.weights).filter(id=>state.weights[id]>0),sumW:()=>Object.values(state.weights).reduce((a,b)=>a+b,0),
    px:()=>100,lotOf:()=>1,investmentIntent:{kind:'monthly',period:'2026-11',amountCny:null,id:''},
    Date:class extends Date { constructor(...args){super(...(args.length?args:['2026-11-09T12:00:00Z']));} }});
  vm.runInContext('const bandOf = w => Math.min(S.abs/100,S.rel/100*w);' +
    source.slice(source.indexOf('function planRebalance('),source.indexOf('function marketRead(')) +
    source.slice(source.indexOf('function investmentActionState('),source.indexOf('function renderOps(')),ctx);
  return vm.runInContext('investmentActionState()',ctx);
}

test('monthly and rebalance launchers remain independent after either operation is booked', () => {
  assert.equal(actions().monthlyEnabled, true);
  assert.equal(actions().rebalanceEnabled, true);
  const monthly = actions({contributionMonth:'2026-11'});
  assert.equal(monthly.monthlyEnabled, false);
  assert.equal(monthly.rebalanceEnabled, true);
  const rebalanced = actions({lastBalanceCheckDate:'2026-11-09'});
  assert.equal(rebalanced.rebalanceEnabled, false);
  assert.equal(rebalanced.monthlyEnabled, true);
});

test('rebalance only opens when the configured rule produces executable trades', () => {
  assert.equal(actions({mode:'none'}).rebalanceEnabled, false);
  assert.equal(actions({mode:'calendar'}).rebalanceEnabled, false); // November is not an annual check month
  assert.equal(actions({allowSell:false}).rebalanceEnabled, false);
  assert.equal(actions({holdings:{A:50,B:50}}).rebalanceEnabled, false);
  assert.equal(actions({weights:{A:30,B:20}}).monthlyEnabled, false);
  assert.equal(actions({weights:{A:30,B:20}}).rebalanceEnabled, false);
});

test('monthly reset funds exactly one additional operation without removing existing receipts', () => {
  const oldReceipt = {investmentType:'monthly',period:'2026-11',operationId:'monthly:2026-11',flow:100};
  const state = {contributionMonth:'2026-11',ledger:{entries:[oldReceipt]},investmentResets:{monthly:{id:'extra-monthly',period:'2026-11'}}};
  const before = JSON.stringify(state);
  const first = plan('monthly',state);
  assert.equal(first.completed,false);
  assert.equal(first.A,100);
  assert.equal(first.operationId,'monthly:2026-11:reset:extra-monthly');
  assert.equal(first.resetId,'extra-monthly');
  assert.equal(Investment.monthlyDone(state,'2026-11-09'),false);
  plan('monthly',state); // a second preview must not spend the opportunity
  assert.equal(JSON.stringify(state),before);
  state.ledger.entries.push({investmentType:'monthly',period:'2026-11',operationId:first.operationId,resetId:first.resetId,flow:100});
  assert.equal(Investment.pendingReset(state,'monthly','2026-11-09'),null);
  assert.equal(Investment.monthlyDone(state,'2026-11-09'),true);
  assert.equal(plan('monthly',state).buy,0);
  assert.equal(state.ledger.entries[0],oldReceipt);
  assert.equal(state.contributionMonth,'2026-11');
});

test('manual rebalance reset bypasses the calendar once and preserves the monthly opportunity', () => {
  const state = {mode:'calendar',lastBalanceCheckDate:'2026-11-01',
    ledger:{entries:[{investmentType:'rebalance',period:'2026-11',operationId:'old-check',date:'2026-11-01'}]},
    investmentResets:{rebalance:{id:'early-check',period:'2026-11'}}};
  const manual = plan('rebalance',state);
  assert.equal(manual.cal,false);
  assert.equal(manual.manual,true);
  assert.equal(manual.rebalance,true);
  assert.equal(manual.A,0);
  assert.ok(manual.buy>0 && manual.sell>0);
  assert.equal(manual.operationId,'rebalance:2026-11:reset:early-check');
  assert.equal(Investment.monthlyDone(state,'2026-11-09'),false);
  state.ledger.entries.push({investmentType:'rebalance',period:'2026-11',operationId:manual.operationId,resetId:manual.resetId,date:'2026-11-09'});
  assert.equal(Investment.rebalanceDone(state,'2026-11-09'),true);
  assert.equal(plan('rebalance',state).rebalance,false);
  assert.equal(state.lastBalanceCheckDate,'2026-11-01');
  assert.equal(state.ledger.entries.length,2);
});

test('reset opportunities survive serialization, expire by month and do not accumulate', () => {
  const state = JSON.parse(JSON.stringify({contributionMonth:'2026-11',investmentResets:{monthly:{id:'pending',period:'2026-11'}}}));
  assert.equal(Investment.pendingReset(state,'monthly','2026-11-30').id,'pending');
  assert.equal(Investment.pendingReset(state,'monthly','2026-12-01'),null);
  assert.equal(Investment.monthlyDone({...state,investmentResets:{monthly:{id:'expired',period:'2026-10'}}},'2026-11-09'),true);
  const firstId = Investment.operationId(state,{kind:'monthly'},'2026-11-09');
  state.ledger={entries:[{investmentType:'monthly',operationId:firstId,resetId:'pending',period:'2026-11'}]};
  state.investmentResets.monthly={id:'new-grant',period:'2026-11'};
  assert.notEqual(Investment.operationId(state,{kind:'monthly'},'2026-11-09'),firstId);
  assert.equal(Object.keys(state.investmentResets).length,1);
});

test('resetting one operation cannot spend or unlock the other kind', () => {
  const state={contributionMonth:'2026-11',lastBalanceCheckDate:'2026-11-09',investmentResets:{monthly:{id:'monthly-only',period:'2026-11'}}};
  assert.equal(Investment.monthlyDone(state,'2026-11-09'),false);
  assert.equal(Investment.rebalanceDone(state,'2026-11-09'),true);
  const calendar = actions({mode:'calendar',lastBalanceCheckDate:'2026-11-09',investmentResets:{rebalance:{id:'force-calendar',period:'2026-11'}}});
  assert.equal(calendar.rebalanceEnabled,true);
  const buyOnly=actions({allowSell:false,investmentResets:{rebalance:{id:'force-calendar',period:'2026-11'}}});
  assert.equal(buyOnly.rebalanceEnabled,true); // the unlocked review opens; execution still respects the sell restriction
  assert.equal(buyOnly.rebalancePlan.rebalance,false);
  assert.equal(buyOnly.rebalancePlan.sell,0);
});

function executionIssue(plan, overrides={}) {
  const ctx=vm.createContext({S:{allowSell:true,...overrides},sumW:()=>100,holdingChanges:()=>[],plan});
  vm.runInContext(source.slice(source.indexOf('function rebalanceExecutionIssue('),source.indexOf('function applyOps(')),ctx);
  return vm.runInContext('rebalanceExecutionIssue(plan)',ctx);
}

test('an unlocked rebalance opens even when holdings are already on target or no trade meets the minimum',()=>{
  const investmentResets={rebalance:{id:'review-balanced',period:'2026-11'}};
  const balanced=actions({holdings:{A:50,B:50},lastBalanceCheckDate:'2026-11-09',investmentResets});
  assert.equal(balanced.rebalanceEnabled,true);
  assert.equal(balanced.rebalanceDone,false);
  assert.equal(balanced.rebalancePlan.buy+balanced.rebalancePlan.sell,0);
  assert.match(executionIssue(balanced.rebalancePlan),/无需买卖/);
  assert.match(executionIssue(balanced.rebalancePlan),/机会会保留/);
  const tiny=actions({holdings:{A:0.005,B:0},wholeShares:true,investmentResets});
  assert.equal(tiny.rebalanceEnabled,true);
  assert.equal(tiny.rebalancePlan.buy+tiny.rebalancePlan.sell,0);
  assert.ok(executionIssue(tiny.rebalancePlan));
});

test('unlocked previews explain missing holdings and sell restrictions without authorizing execution',()=>{
  const investmentResets={rebalance:{id:'review-blocked',period:'2026-11'}};
  const empty=actions({holdings:{A:0,B:0},investmentResets});
  assert.equal(empty.rebalanceEnabled,true);
  assert.match(executionIssue(empty.rebalancePlan),/没有持仓/);
  const buyOnly=actions({allowSell:false,investmentResets});
  assert.equal(buyOnly.rebalanceEnabled,true);
  assert.match(executionIssue(buyOnly.rebalancePlan,{allowSell:false}),/只买不卖/);
  assert.equal(executionIssue(actions({investmentResets}).rebalancePlan),'');
});

test('opening an unlocked no-trade preview cannot create a zero-trade receipt or consume the reset',async()=>{
  const state={allowSell:true,investmentResets:{rebalance:{id:'review-only',period:'2026-11'}}};
  const action=actions({...state,holdings:{A:50,B:50}}),submit={disabled:false},dialog={open:false,showModal(){this.open=true;}};
  let recorded=0;
  const ctx=vm.createContext({S:state,Investment,crypto:{randomUUID:()=> 'draft'},todayStr:()=> '2026-11-09',
    sumW:()=>100,holdingChanges:()=>[],investmentActionState:()=>action,planRebalance:()=>action.rebalancePlan,
    opsContext:()=> 'unchanged',renderRebalancePreview:()=>{},rebalanceError:()=>{},
    $:id=>id==='#opsConfirm'?dialog:submit,recordInvestment:()=>{recorded++;},
    withCurrentHoldings:async run=>run()});
  vm.runInContext('let pendingOps=null;'+source.slice(source.indexOf('function rebalanceExecutionIssue('),source.indexOf('function bindRebalance(')),ctx);
  vm.runInContext('applyOps()',ctx);
  assert.equal(dialog.open,true);assert.equal(submit.disabled,true);
  await vm.runInContext('confirmOps({preventDefault(){},currentTarget:{reportValidity:()=>true}})',ctx);
  assert.equal(recorded,0);
  assert.equal(Investment.pendingReset(state,'rebalance','2026-11-09').id,'review-only');
});

function recordReset(kind, persist) {
  const Ledger = vm.runInNewContext(readFileSync(new URL('../ledger.js', import.meta.url), 'utf8') + '\nLedger');
  const ledgerUiSource = readFileSync(new URL('../ledger-ui.js', import.meta.url),'utf8');
  const state = {weights:{A:50,B:50},holdings:{A:8,B:2},monthly:100,fx:1,abs:5,rel:25,mode:'calendar',period:'Y',cashflow:true,allowSell:true,
    contributionMonth:'2026-11',lastBalanceCheckDate:'2026-11-01',investmentResets:{[kind]:{id:'single-use',period:'2026-11'}}};
  const price = id => id === 'A' ? 123.45 : 234.56;
  state.ledger = Ledger.open(state.holdings,'2026-11-01','2026-11-01',price,1000);
  state.ledger.revision = 'before';
  state.ledger.entries.push({investmentType:kind,operationId:`${kind}:2026-11`,period:'2026-11',date:'2026-11-01',flow:100,trades:[]});
  const before = JSON.stringify(state), execution = plan(kind,state);
  const ctx = vm.createContext({S:structuredClone(state),Ledger,Investment,structuredClone,persist,
    todayStr:()=> '2026-11-09',D:{asOf:'2026-11-09'},px:price,opsContext:()=> 'snapshot',investmentIntent:{kind},
    INVESTMENT_LABELS:{monthly:'定投',rebalance:'再平衡'},crypto:{randomUUID:()=> 'after'},toast:()=>{},execution,
    request:{kind,period:'2026-11',operationId:execution.operationId}});
  vm.runInContext("let ledgerRevision='before', savedSnapshot=null; const save=()=>{if(!persist)return false;savedSnapshot=JSON.stringify(S);ledgerRevision=S.ledger.revision;return true;};" +
    ledgerUiSource.slice(ledgerUiSource.indexOf('function saveLedgerChange('),ledgerUiSource.indexOf('function bindLedger(')) +
    source.slice(source.indexOf('function recordInvestment('),source.indexOf('async function confirmMonthlyInvestment(')),ctx);
  const saved = vm.runInContext('recordInvestment(execution,request)',ctx);
  return {saved,before,state:JSON.parse(vm.runInContext('JSON.stringify(S)',ctx)),snapshot:vm.runInContext('savedSnapshot',ctx)};
}

test('successful recording persists the reset receipt and consumes only its own opportunity', () => {
  for (const kind of ['monthly','rebalance']) {
    const result = recordReset(kind,true), receipt = result.state.ledger.entries.at(-1);
    assert.equal(result.saved,true);
    assert.equal(result.state.ledger.entries.length,2);
    assert.equal(receipt.resetId,'single-use');
    assert.equal(receipt.operationId,`${kind}:2026-11:reset:single-use`);
    assert.equal(Investment.pendingReset(result.state,kind,'2026-11-09'),null);
    assert.equal(Investment.operationDone(JSON.parse(result.snapshot),{kind,id:'new-preview'},'2026-11-09'),true);
    assert.equal(result.state.ledger.entries[0].operationId,`${kind}:2026-11`);
  }
});

test('a failed recording restores holdings and history and leaves the reset available', () => {
  for (const kind of ['monthly','rebalance']) {
    const result = recordReset(kind,false);
    assert.equal(result.saved,false);
    assert.equal(JSON.stringify(result.state),result.before);
    assert.equal(result.snapshot,null);
    assert.equal(Investment.pendingReset(result.state,kind,'2026-11-09').id,'single-use');
  }
});
