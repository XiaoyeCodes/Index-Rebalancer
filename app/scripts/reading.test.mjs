import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Exercise the actual planner and reading code together, without browser/CDN dependencies.
const source = fs.readFileSync(new URL('../src.html', import.meta.url), 'utf8');
const section = (from, to) => source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)));
function fixture() {
  const elements = new Map();
  const $ = selector => {
    if (!elements.has(selector)) elements.set(selector, { innerHTML: '', textContent: '', disabled: false, hidden: false });
    return elements.get(selector);
  };
  const sandbox = vm.createContext({ $, console,
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : ['2026-11-08T12:00:00Z'])); } },
    S: { weights: { AAA: 50, BBB: 50 }, holdings: { AAA: 50, BBB: 50 }, monthly: 100, fx: 1,
      cashflow: true, mode: 'threshold', abs: 5, rel: 25, period: 'Y', allowSell: true, fee: 0.05 },
    A: { AAA: { cn: 'Asset A', risk: 4 }, BBB: { cn: 'Asset B', risk: 3 } },
    D: { n: 131, asOf: '2026-11-06', assets: { AAA: { first: 0, c: Array(131).fill(100) }, BBB: { first: 0, c: Array(131).fill(100) } } },
    N: 131, ST: { AAA: { vol: 0.2 }, BBB: { vol: 0.1 } },
    receiptApplied: false, appliedContribution: false, backtests: [],
    fmtPct: (v, digits = 1, sign = false) => v == null || !Number.isFinite(v) ? '—' : (sign && v > 0 ? '+' : '') + (v * 100).toFixed(digits) + '%',
    usd: v => '$' + v.toFixed(2), assetLogo: () => '', ym: () => '2024-05',
    backtest: cfg => { sandbox.backtests.push(cfg); return { s0: 0, vol: 0.17, mdd: -0.4 }; },
  });
  vm.runInContext(`
    const modelIds = () => Object.keys(S.weights).filter(id => S.weights[id] > 0);
    const sumW = () => Object.values(S.weights).reduce((a,b) => a+b,0);
    const bandOf = tw => Math.min(S.abs/100,S.rel/100*tw);
    const px = () => 100, lotOf = () => 1;
    const currentOpsApplied = () => receiptApplied;
    const contributionApplied = () => appliedContribution;
    const opsContext = () => JSON.stringify([S,receiptApplied,appliedContribution]);
    let readCtl = null;
    ${section('function planRebalance()', 'function marketRead(')}
    ${section('function marketRead(', 'function renderOps(')}
    ${section('let modelBt = null', 'function renderRebalance(')}
  `, sandbox);
  const evaluate = code => vm.runInContext(code, sandbox);
  const render = () => evaluate('renderReading(planRebalance())');
  return { sandbox, $, evaluate, render };
}

test('balanced and sub-display drifts do not invent a largest deviation or signed zero', () => {
  const f = fixture();
  for (const drift of [0, 0.0002, -0.0002]) {
    f.sandbox.S.holdings = { AAA: 50 + drift * 100, BBB: 50 - drift * 100 };
    f.render();
    assert.match(f.$('#readSummary').innerHTML, /配置与目标基本一致/);
    assert.match(f.$('#readMini').innerHTML, /基本到位/);
    assert.doesNotMatch(f.$('#readMini').innerHTML, /[+-]0\.0/);
  }
});

test('a tiny drift still warns if the user configured a tighter band', () => {
  const f = fixture();
  Object.assign(f.sandbox.S, { abs: 0.001, holdings: { AAA: 50.02, BBB: 49.98 } });
  f.render();
  assert.match(f.$('#readSummary').innerHTML, /偏离超出阈值/);
  assert.match(f.$('#readMini').innerHTML, /不足 0.1 个百分点/);
  assert.doesNotMatch(f.$('#readMini').innerHTML, /[+-]0\.0/);
});

test('high-volatility grouping includes R4 assets, matching the balance', () => {
  const f = fixture(); f.render();
  assert.match(f.$('#readMini').innerHTML, /50\.0% \/ 50\.0%/);
  assert.match(f.$('#readMini').innerHTML, /R4 及以上/);
});

test('no cash means hold, even for an underweight asset', () => {
  const f = fixture();
  Object.assign(f.sandbox.S, { monthly: 0, holdings: { AAA: 49, BBB: 51 } });
  assert.match(f.evaluate('assetReading("AAA",planRebalance())'), /保持不动/);
  assert.match(f.evaluate('readingAction(planRebalance()).title'), /无需交易/);
});

test('an overweight asset that actually receives money is correctly described as bought', () => {
  const f = fixture();
  Object.assign(f.sandbox.S, { cashflow: false, monthly: 5000, holdings: { AAA: 51, BBB: 49 } });
  assert.ok(f.evaluate('planRebalance().delta.AAA') > 0);
  assert.match(f.evaluate('assetReading("AAA",planRebalance())'), /买入 \$2500\.00/);
});

test('sell restrictions retain residual warnings instead of promising correction', () => {
  const f = fixture();
  Object.assign(f.sandbox.S, { allowSell: false, monthly: 100, holdings: { AAA: 90, BBB: 10 } });
  const detail = f.evaluate('readingAction(planRebalance()).detail');
  assert.match(detail, /只买不卖/);
  assert.match(detail, /操作后仍有 2 个标的超出阈值/);
  assert.doesNotMatch(f.evaluate('assetReading("AAA",planRebalance())'), /卖出 \$/);
});

test('calendar-only mode does not claim a threshold crossing caused a rebalance', () => {
  const f = fixture();
  Object.assign(f.sandbox.S, { mode: 'calendar', monthly: 100, holdings: { AAA: 90, BBB: 10 } });
  const detail = f.evaluate('readingAction(planRebalance()).detail');
  assert.match(detail, /按现有规则本月不触发卖出/);
  assert.match(detail, /操作后仍有/);
});

test('whole-share constraints are reflected in actual post-trade deviations', () => {
  const f = fixture();
  Object.assign(f.sandbox.S, { wholeShares: true, abs: 3, monthly: 40, holdings: { AAA: 1, BBB: 0 } });
  const plan = f.evaluate('planRebalance()');
  assert.ok(plan.delta.AAA === 0);
  assert.match(f.evaluate('assetReading("AAA",planRebalance())'), /暂不卖出/);
  assert.match(f.evaluate('readingAction(planRebalance()).detail'), /整股 \/ 整手限制/);
});

test('empty holdings and recorded execution do not suggest trades twice', () => {
  const f = fixture();
  f.sandbox.S.holdings = { AAA: 0, BBB: 0 }; f.render();
  assert.match(f.$('#readSummary').innerHTML, /还未录入持仓/);
  assert.match(f.$('#readMini').innerHTML, /待录入持仓/);
  f.sandbox.receiptApplied = true;
  assert.match(f.evaluate('readingAction(planRebalance()).title'), /已记账/);
  assert.match(f.evaluate('assetReading("AAA",planRebalance())'), /无需重复下单/);
});

test('short histories do not masquerade as a year of returns or a complete trend', () => {
  const f = fixture();
  f.sandbox.D.assets.AAA.c = [100, 101, 103];
  const m = f.evaluate('marketRead("AAA")');
  assert.equal(m.r4, null); assert.equal(m.r52, null); assert.equal(m.vol, null); assert.equal(m.trend, 'short');
  f.render();
  assert.match(f.$('#readCards').innerHTML, /距已有区间周收盘高点/);
  assert.doesNotMatch(f.$('#readCards').innerHTML, /常见波动约|跌了多买|落袋/);
});

test('risk cache respects fees and data dates; invalid and empty models clear old results', () => {
  const f = fixture(); f.render(); f.render();
  assert.equal(f.sandbox.backtests.length, 1);
  f.sandbox.S.fee = 0.1; f.render(); assert.equal(f.sandbox.backtests.length, 2);
  f.sandbox.D.asOf = '2026-11-09'; f.render(); assert.equal(f.sandbox.backtests.length, 3);
  f.sandbox.S.weights.BBB = 25; f.render();
  assert.equal(f.evaluate('modelBt'), null);
  assert.match(f.$('#readMini').innerHTML, /目标权重需合计 100%/);
  f.sandbox.S.weights = {}; f.render();
  assert.equal(f.evaluate('modelBt'), null);
  assert.match(f.$('#readSummary').innerHTML, /选择标的和目标权重/);
});
