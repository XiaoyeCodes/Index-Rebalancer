import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../src.html', import.meta.url), 'utf8');
const section = (from, to) => source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)));
const week = 7 * 864e5;
function engine(assets, n = Math.max(...Object.values(assets).map(asset => asset.first + asset.c.length))) {
  const W0 = Date.parse('2000-01-03T00:00:00Z');
  const wDate = i => new Date(W0 + i * week);
  const context = vm.createContext({ D: { assets }, A: {}, N: n, W0, WK: week,
    wDate, ymd: date => date.toISOString().slice(0, 10), ym: i => wDate(i).toISOString().slice(0, 7) });
  vm.runInContext(section('const CUR =', '/* ---------------- asset statistics'), context);
  vm.runInContext(section('function startIndex(', '/* ---------------- 01 assets view'), context);
  return {
    run(cfg = {}) {
      context.cfg = { weights: { AAA: 100 }, start: '2000-01', initial: 1000, monthly: 0,
        fee: 0, mode: 'none', abs: 5, rel: 30, period: 'Y', cashflow: false, ...cfg };
      return vm.runInContext('backtest(cfg)', context);
    },
    evaluate(code) { return vm.runInContext(code, context); },
    context,
  };
}
function asset(prices, first = 0, meta = {}) {
  return { first, o: [...prices], h: [...prices], l: [...prices], c: [...prices], ...meta };
}
const close = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

test('portfolio starts when both holdings exist instead of reallocating the missing holding', () => {
  const e = engine({ AAA: asset([100, 90, 80, 100]), BBB: asset([100, 100], 2) });
  const result = e.run({ weights: { AAA: 50, BBB: 50 } });
  assert.equal(result.s0, 2);
  assert.equal(result.nav.length, 2);
  close(result.final, 1125);
  close(result.wHist[0].w.BBB, 500 / 1125);
});

test('actual inception and the end of a proxy splice both constrain the start', () => {
  const e = engine({ AAA: asset([100, 100, 100, 100, 100], 0,
    { actualFirst: '2000-01-11', spliceWeek: '2000-01-24' }) });
  assert.equal(e.run().s0, 3);
  e.context.D.assets.AAA.spliceWeek = null;
  assert.equal(e.run().s0, 2); // first complete week after the Tuesday inception
});

test('a benchmark accepts the strategy start and receives the same contributions', () => {
  const e = engine({ AAA: asset(Array(10).fill(100)), BBB: asset(Array(8).fill(100), 2) });
  const strategy = e.run({ weights: { AAA: 50, BBB: 50 }, monthly: 100 });
  const benchmark = e.run({ weights: { AAA: 100 }, monthly: 100, startWeek: strategy.s0 });
  assert.equal(benchmark.s0, strategy.s0);
  assert.equal(benchmark.invested, strategy.invested);
  close(benchmark.final, strategy.final);
});

test('new monthly cash cannot hide a 50 percent loss in unit NAV', () => {
  const e = engine({ AAA: asset([100, 100, 100, 100, 100, 50]) });
  const result = e.run({ initial: 0, monthly: 1000 });
  assert.equal(result.invested, 2000);
  assert.equal(result.contributionCount, 2);
  close(result.final, 1500); // account balance rises with the second deposit
  close(result.nav.at(-1).c, 0.5);
  close(result.mdd, -0.5);
});

test('first-purchase fees count toward drawdown and time-weighted return', () => {
  const result = engine({ AAA: asset(Array(54).fill(100)) }).run({ fee: 1 });
  close(result.final, 1000 / 1.01);
  close(result.mdd, 1 / 1.01 - 1);
  close(result.twr, Math.pow(1 / 1.01, 1 / result.durationYears) - 1);
  close(result.years['2000'].s,1);
});

test('XIRR agrees with the independently published Excel example on Actual/365', () => {
  const e = engine({ AAA: asset([100, 100]) });
  e.context.flows = [
    ['2008-01-01', -10000], ['2008-03-01', 2750], ['2008-10-30', 4250],
    ['2009-02-15', 3250], ['2009-04-01', 2750],
  ].map(([date, amount]) => [Date.parse(date), amount]);
  close(e.evaluate('xirr(flows)'), 0.373362535, 1e-8);
  assert.equal(e.evaluate('xirr([[0, -100], [0, 101]])'), null);
  assert.equal(e.evaluate('xirr([[0, 100], [86400000, 101]])'), null);
});

test('XIRR uses actual closing dates, including an incomplete final trading week',()=>{
  const e=engine({AAA:asset([100,100,110])});
  e.context.D.dates=['2000-01-07','2000-01-14','2000-01-19'];
  const r=e.run();
  close(r.xirr,Math.pow(1.1,365/12)-1,1e-8);
});

test('rebalance fees conserve cash using the actual executed notional',()=>{
  const r=engine({AAA:asset([100,200]),BBB:asset([100,100])}).run({weights:{AAA:30,BBB:70},fee:1,mode:'threshold',abs:1,rel:1});
  assert.equal(r.log.length,1);
  const before=1000/1.01*1.3;
  const traded=r.log[0].trades.reduce((sum,[,amount])=>sum+Math.abs(amount),0);
  close(r.final+traded*.01,before,1e-8);
  close(r.wHist.at(-1).w.AAA,.3);
  close(r.wHist.at(-1).w.BBB,.7);
});

test('the three requested models share real history and identical contribution dates', () => {
  const data = JSON.parse(fs.readFileSync(new URL('../data/prices-weekly.json', import.meta.url), 'utf8'));
  const e = engine(data.assets, data.n);
  e.context.D = data;
  e.context.W0 = Date.parse(data.start + 'T00:00:00Z');
  e.context.wDate = i => new Date(e.context.W0 + i * week);
  e.context.ym = i => e.context.wDate(i).toISOString().slice(0, 7);
  const presets = vm.runInNewContext(section('const PRESETS =', '// Retain older') + '\nPRESETS');
  const results = presets.filter(preset => ['growth-dca', 'family-dca', 'income-dca'].includes(preset.key))
    .map(preset => e.run({ weights: preset.w, initial: 0, monthly: 3000, fee: 0.05, ...preset.rule, cashflow: true }));
  assert.equal(results.length, 3);
  for (const result of results) {
    assert.equal(e.context.wDate(result.s0).toISOString().slice(0, 10), '2020-11-09');
    assert.ok(Number.isFinite(result.xirr));
    assert.ok(result.mdd > -0.83);
  }
  assert.equal(new Set(results.map(result => result.invested)).size, 1);
});

test('saved built-in model labels follow their renamed titles without changing weights', () => {
  const context = vm.createContext({});
  vm.runInContext(section('const PRESETS =', '// Retain older') +
    section('function migrateExecutionState(', 'const defaultState ='), context);
  const migrated = vm.runInContext('migrateExecutionState({preset:"family-dca",label:"方案二 · 中产稳健家庭型",weights:{VOO:50,QQQM:25,SCHD:15,SGOV:5,GLDM:5}})', context);
  assert.equal(migrated.label, '中产稳健家庭型');
  assert.equal(migrated.weights.VOO, 50);
  assert.equal(Object.values(migrated.weights).reduce((sum, weight) => sum + weight, 0), 100);
});
