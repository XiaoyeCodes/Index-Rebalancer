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
