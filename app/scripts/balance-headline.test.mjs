import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../src.html', import.meta.url), 'utf8');
const code = source.slice(source.indexOf('function balanceView('), source.indexOf('function renderBalanceHeadline('));
function fixture() {
  const ctx = vm.createContext({
    S: { mode: 'threshold', abs: 5, rel: 25, period: 'Q' },
    A: { H: { risk: 4 }, H2: { risk: 5 }, L: { risk: 3 } }, READ_EPS: 0.0005,
    todayStr: () => '2026-11-09',
  });
  vm.runInContext('const bandOf = w => Math.min(S.abs/100,S.rel/100*w);' + code, ctx);
  const plan = (high, highTarget = 0.5, high2 = 0) => ({
    ids: high2 ? ['H', 'H2', 'L'] : ['H', 'L'],
    tw: { H: highTarget, H2: high2, L: 1 - highTarget - high2 },
    cur: { H: high, H2: high2, L: 1 - high - high2 },
    after: { H: highTarget, H2: high2, L: 1 - highTarget - high2 }, V: 1000, afterV: 1000,
  });
  const state = (p, date = '2026-11-09') => { ctx.plan = p; ctx.today = date; return vm.runInContext('balanceHeadlineState(plan,today)', ctx); };
  return { ctx, plan, state };
}

test('balanced holdings use the requested wording, including when an old schedule was missed', () => {
  const f = fixture(); Object.assign(f.ctx.S, { mode: 'calendar', lastExecutionDate: '2026-07-01' });
  assert.equal(f.state(f.plan(0.5)).text, '目前已经平衡，正如他应有的样子');
  assert.equal(f.state(f.plan(0.524)).state, 'level');
});

test('small group deviations name the correct direction, and larger ones warn', () => {
  const f = fixture();
  assert.equal(f.state(f.plan(0.53)).text, '当前有点向高波动倾斜哦');
  assert.equal(f.state(f.plan(0.47)).text, '当前有点向低波动倾斜哦');
  assert.equal(f.state(f.plan(0.56)).text, '当前天平要翻啦，赶紧再平衡一下吧。');
  assert.equal(f.state(f.plan(0.44)).state, 'out');
  assert.equal(f.state(f.plan(0.525)).state, 'drift');
  assert.equal(f.state(f.plan(0.55)).state, 'out');
});

test('overdue takes priority over tilt severity after a known quarterly deadline', () => {
  const f = fixture(); Object.assign(f.ctx.S, { mode: 'hybrid', lastExecutionDate: '2026-07-15' });
  assert.equal(f.state(f.plan(0.53)).text, '当前已过平衡时间，快来再平衡一下吧。');
  assert.equal(f.state(f.plan(0.8)).state, 'overdue');
  assert.equal(f.state(f.plan(0.53), '2026-10-01').state, 'drift');
  assert.equal(f.state(f.plan(0.53), '2026-10-02').state, 'overdue');
});

test('annual schedule rolls over years and completed cycles advance the deadline', () => {
  const f = fixture(); Object.assign(f.ctx.S, { mode: 'calendar', period: 'Y', lastExecutionDate: '2025-12-31' });
  assert.equal(f.state(f.plan(0.53), '2026-01-01').state, 'drift');
  assert.equal(f.state(f.plan(0.53), '2026-01-02').state, 'overdue');
  f.ctx.S.lastExecutionDate = '2026-01-02';
  f.ctx.S.lastAppliedOps = { confirmedOn: '2025-01-01' };
  assert.equal(f.state(f.plan(0.53), '2026-11-09').state, 'drift');
});

test('first visits, invalid dates and threshold-only monthly reminders do not invent overdue rebalances', () => {
  const f = fixture(); f.ctx.S.mode = 'calendar';
  assert.equal(f.state(f.plan(0.53)).state, 'drift');
  f.ctx.S.lastExecutionDate = 'invalid';
  assert.equal(f.state(f.plan(0.53)).state, 'drift');
  Object.assign(f.ctx.S, { mode: 'threshold', lastExecutionDate: '2020-01-01', investmentDay: 1 });
  assert.equal(f.state(f.plan(0.53)).state, 'drift');
  f.ctx.S.mode = 'none';
  assert.equal(f.state(f.plan(0.53)).state, 'drift');
});

test('a confirmed opening ledger can establish the first scheduled cycle', () => {
  const f = fixture(); Object.assign(f.ctx.S, { mode: 'calendar', ledger: { date: '2026-07-01' } });
  assert.equal(f.state(f.plan(0.53)).state, 'overdue');
});

test('previewing proposed trades never reports them as completed', () => {
  const f = fixture(); const p = f.plan(0.6);
  assert.equal(f.state(p).state, 'out');
  f.ctx.plan = p;
  assert.equal(vm.runInContext('balanceView(plan,"after").status', f.ctx), 'level');
  assert.equal(f.state(p).state, 'out');
});

test('offsetting deviations within a pan keep the actual beam level', () => {
  const f = fixture(); const p = f.plan(0.25, 0.25, 0.25);
  p.cur.H = 0.4; p.cur.H2 = 0.1;
  assert.equal(f.state(p).state, 'level');
  f.ctx.plan = p;
  assert.equal(vm.runInContext('balanceView(plan,"now").outCount', f.ctx), 2);
});

test('empty holdings and a single populated target pan avoid false warnings', () => {
  const f = fixture(); const p = f.plan(0.5); p.V = 0;
  assert.equal(f.state(p).state, 'empty');
  assert.equal(f.state(f.plan(1, 1)).state, 'level');
});
