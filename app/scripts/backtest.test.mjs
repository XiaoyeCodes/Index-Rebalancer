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

const driftingAssets = () => ({ AAA: asset([100, 200, 200, 200, 200, 200, 400]), BBB: asset(Array(7).fill(100)) });
const driftConfig = { weights: { AAA: 50, BBB: 50 }, initial: 1000, monthly: 100, abs: 1, rel: 1 };

test('fixed DCA, buy-only deficit funding and buy/sell rebalancing produce distinct cash-conserving paths', () => {
  const e = engine(driftingAssets());
  const fixed = e.run({ ...driftConfig, mode: 'none', cashflow: true, allowSell: true });
  const buyOnly = e.run({ ...driftConfig, mode: 'threshold', cashflow: true, allowSell: false });
  const rebalanced = e.run({ ...driftConfig, mode: 'threshold', cashflow: true, allowSell: true });
  // January receives 1100, February 100. Fixed buys 50/50 in February even
  // though AAA is overweight; buy-only puts that entire 100 into BBB.
  close(fixed.final, 2900);
  close(buyOnly.final, 2850);
  close(rebalanced.final, 2625);
  assert.equal(fixed.cfg.cashflow, false);
  assert.equal(fixed.rebCount, 0);
  assert.equal(buyOnly.rebCount, 0);
  assert.equal(buyOnly.log.length, 0);
  assert.equal(buyOnly.marks.length, 0);
  assert.equal(rebalanced.rebCount, 2);
  assert.ok(rebalanced.log.every(entry => entry.trades.some(([, n]) => n < 0) && entry.trades.some(([, n]) => n > 0)));
  for (const r of [fixed, buyOnly, rebalanced]) assert.equal(r.invested, 1200);
  const benchmark = e.run({ ...driftConfig, mode: 'none', cashflow: false, allowSell: false });
  assert.equal(JSON.stringify(fixed.nav), JSON.stringify(benchmark.nav));
  assert.equal(JSON.stringify(fixed.val), JSON.stringify(benchmark.val));
});

test('sell restrictions apply to calendar and hybrid triggers as well as threshold triggers', () => {
  const assets = { AAA: asset(Array.from({ length: 60 }, (_, i) => 100 + i * 5)), BBB: asset(Array(60).fill(100)) };
  for (const mode of ['calendar', 'hybrid', 'threshold']) {
    const e = engine(assets);
    const r = e.run({ ...driftConfig, monthly: 0, mode, allowSell: false, cashflow: false, period: 'Q' });
    close(r.final, 2475);
    assert.equal(r.rebCount, 0);
    assert.equal(r.cfg.cashflow, true);
    assert.ok(e.run({ ...driftConfig, monthly: 0, mode, allowSell: true, period: 'Q' }).rebCount > 0);
  }
});

test('comparisons omit the selected policy and keep the other policies on identical funding and history', () => {
  const assets = { AAA: asset(Array.from({ length: 66 }, (_, i) => 100 * 1.02 ** i)),
    BBB: asset(Array(64).fill(100), 2), SPY: asset(Array(66).fill(100)) };
  const e = engine(assets);
  for (const mode of ['none', 'threshold', 'calendar', 'hybrid']) for (const period of ['Q', 'Y']) {
    for (const [allowSell, cashflow] of [[false, true], [true, true], [true, false]]) {
      const current = e.run({ ...driftConfig, mode, period, allowSell, cashflow, fee: 0.15 });
      e.context.current = current;
      const rows = e.evaluate('backtestComparisons(cfg, current)');
      const selected = mode === 'none' ? 'fixed' : !allowSell ? 'buy-only' : cashflow ? 'rebalance-cash' : 'rebalance-fixed';
      const expected = ['strategy', 'sp500', 'fixed', 'buy-only', 'rebalance-cash', 'rebalance-fixed'].filter(key => key !== selected);
      assert.equal(JSON.stringify(rows.map(row => row.key)), JSON.stringify(expected));
      assert.equal(rows[0].result, current);
      for (const { key, result } of rows) {
        assert.equal(result.s0, current.s0);
        assert.equal(JSON.stringify(result.inv), JSON.stringify(current.inv));
        assert.equal(result.cfg.fee, 0.15);
        if (key !== 'sp500') assert.equal(JSON.stringify(result.cfg.weights), JSON.stringify(current.cfg.weights));
      }
      assert.equal(rows.find(row => row.key === 'sp500').result.cfg.weights.SPY, 100);
      for (const row of rows.slice(1)) {
        const actual = row.result.cfg;
        if (!row.key.startsWith('rebalance-')) assert.equal(row.result.rebCount, 0);
        if (row.key === 'fixed') assert.equal(actual.cashflow, false);
        if (row.key === 'buy-only') { assert.equal(actual.allowSell, false); assert.equal(actual.cashflow, true); }
        if (!row.key.startsWith('rebalance-')) continue;
        assert.equal(actual.cashflow, row.key === 'rebalance-cash');
        assert.equal(actual.allowSell, true);
        assert.equal(actual.mode, mode === 'none' ? 'calendar' : mode);
        assert.equal(actual.period, period);
        assert.equal(actual.abs, current.cfg.abs);
        assert.equal(actual.rel, current.cfg.rel);
        assert.ok(row.detail.includes(mode === 'threshold' ? '仅阈值再平衡' : period === 'Q' ? '按季再平衡' : '按年再平衡'));
      }
    }
  }
});

test('quarterly and annual comparison labels follow their actual trading schedules', () => {
  const e = engine({ AAA: asset(Array.from({ length: 66 }, (_, i) => 100 * 1.02 ** i)),
    BBB: asset(Array(66).fill(100)), SPY: asset(Array(66).fill(100)) });
  const results = [];
  for (const period of ['Q', 'Y']) {
    e.run({ ...driftConfig, mode: 'calendar', period, allowSell: true, cashflow: true, fee: 0.05 });
    results.push(e.evaluate('backtestComparisons(cfg).find(row => row.key === "rebalance-fixed")'));
  }
  assert.ok(results[0].result.rebCount > results[1].result.rebCount);
  assert.notEqual(results[0].result.final, results[1].result.final);
  assert.match(results[0].detail, /按季再平衡/);
  assert.match(results[1].detail, /按年再平衡/);
});

test('cash allocation changes results while identical or merely numerically equal policies are handled separately', () => {
  const e = engine({ ...driftingAssets(), SPY: asset(Array(7).fill(100)) });
  e.run({ ...driftConfig, mode: 'calendar', period: 'Y', allowSell: true, cashflow: true });
  const rows = e.evaluate('backtestComparisons(cfg)');
  assert.equal(rows.length, 5);
  assert.equal(rows.some(row => row.key === 'rebalance-cash'), false);
  close(rows[0].result.final, 2850);
  const fixedCash = rows.find(row => row.key === 'rebalance-fixed');
  close(fixedCash.result.final, 2900);
  assert.match(fixedCash.label, /新钱固定比例/);
  assert.match(rows[0].detail, /新钱补低配/);
  // No scheduled trade occurs in January/February, so these distinct policies
  // happen to have equal outcomes. Hide by policy, never by rounded metrics.
  close(rows.find(row => row.key === 'buy-only').result.final, 2850);
  close(rows.find(row => row.key === 'fixed').result.final, 2900);
});

test('policy controls prevent conflicting fixed, buy-only and buy/sell settings', () => {
  const e = engine(driftingAssets()), nodes = new Map();
  e.context.$ = selector => { if (!nodes.has(selector)) nodes.set(selector, {}); return nodes.get(selector); };
  e.context.S = { ...driftConfig, mode: 'none', cashflow: true, allowSell: true };
  e.evaluate(section('function syncModelControls(', 'function syncTradeSettings('));
  for (const policy of ['fixed', 'buy-only', 'rebalance']) {
    e.evaluate(`setInvestmentPolicy('${policy}'); syncModelControls()`);
    assert.equal(nodes.get('#pPolicy').value, policy);
    assert.equal(nodes.get('#pMode').disabled, policy !== 'rebalance');
    assert.equal(nodes.get('#pCash').disabled, policy !== 'rebalance');
    assert.equal(e.evaluate('modelBacktestConfig(S).allowSell'), policy === 'rebalance');
    if (policy === 'fixed') assert.equal(nodes.get('#pCash').checked, false);
    if (policy === 'buy-only') assert.equal(nodes.get('#pCash').checked, true);
  }
});

test('every backtest chart and comparison rerenders from the current complete model configuration', () => {
  const e = engine(driftingAssets()), nodes = new Map();
  e.context.A = { AAA: { color: '#111111' }, BBB: { color: '#222222' } };
  e.context.D.assets.SPY = asset(Array(7).fill(100));
  const series = () => ({ setData(data) { this.data = data; }, setMarkers(markers) { this.markers = markers; } });
  const scale = { fitContent() {} };
  const chart = { timeScale: () => scale };
  e.context.fixture = { nav: chart, navS: series(), b1: series(), val: chart, valS: series(), invS: series() };
  e.context.S = { ...driftConfig, start: '2000-01', fee: 0, mode: 'none', cashflow: false, allowSell: false };
  e.context.$ = selector => { if (!nodes.has(selector)) nodes.set(selector, {}); return nodes.get(selector); };
  e.context.fmtMoney = e.context.fmtPct = e.context.esc = value => String(value);
  e.context.sumW = () => 100;
  for (const name of ['setMarkers', 'setAssetChart', 'renderStack', 'renderYears', 'renderLog']) e.context[name] = () => {};
  e.evaluate(section('let bt =', '// floating hover card'));
  e.evaluate(section('const STRAT =', 'const pctFmt ='));
  e.evaluate(section('function setMarkers(', '// one asset alone'));
  e.evaluate(section('function paginateBacktestRows(', '/* ---------------- 00 rebalance view'));
  e.evaluate('bt = fixture');
  for (const [policy, expected] of [['fixed', 2900], ['buy-only', 2850], ['rebalance', 2625]]) {
    e.evaluate(`setInvestmentPolicy('${policy}'); S.mode = S.mode === 'none' ? 'none' : 'threshold'; renderBacktest()`);
    close(e.evaluate('bt.r.final'), expected);
    assert.equal(JSON.stringify(e.context.fixture.navS.data), e.evaluate('JSON.stringify(navMonthly(bt.r))'));
    assert.equal(e.context.fixture.valS.data.at(-1).value, expected);
    assert.equal(e.context.fixture.invS.data.at(-1).value, 1200);
    assert.equal(e.context.fixture.valS.data.at(-1).value, e.evaluate('bt.r.final'));
    assert.equal(e.evaluate('JSON.stringify(cmpData(STRAT))'), e.evaluate('JSON.stringify(navLine(bt.r))'));
    assert.ok(nodes.get('#cmpTable').innerHTML.includes(String(expected)));
    assert.equal((nodes.get('#cmpTable').innerHTML.match(/data-comparison=/g) || []).length, 5);
    const selectedKey = policy === 'rebalance' ? 'rebalance-cash' : policy;
    assert.ok(!nodes.get('#cmpTable').innerHTML.includes(`data-comparison="${selectedKey}"`));
    assert.ok(nodes.get('#cmpTable').innerHTML.includes(e.evaluate('investmentPolicyLabel(modelBacktestConfig(S))')));
    assert.equal(nodes.get('#navRebalanceLegend').hidden, policy !== 'rebalance');
    assert.equal(e.context.fixture.navS.markers.length, policy === 'rebalance' ? 2 : 0);
    if (policy === 'fixed') {
      assert.match(nodes.get('#cmpNote').innerHTML, /规则相同的对照已合并/);
    }
    if (policy === 'buy-only') {
      assert.match(nodes.get('#cmpNote').innerHTML, /新钱补低配/);
      assert.match(nodes.get('#logTable').innerHTML, /没有卖出或存量调仓/);
    }
  }
  e.context.S.monthly = 200;
  e.context.S.initial = 2000;
  e.evaluate('renderBacktest()');
  close(e.context.fixture.invS.data.at(-1).value, 2400);
  close(e.context.fixture.valS.data.at(-1).value, 5250);
  e.evaluate('S.abs = 30; S.rel = 100; renderBacktest()');
  assert.equal(e.evaluate('investmentPolicy(S)'), 'rebalance');
  assert.equal(e.evaluate('bt.r.rebCount'), 0);
  assert.equal(nodes.get('#navRebalanceLegend').hidden, true);
  assert.equal(e.context.fixture.navS.markers.length, 0);
  e.evaluate("setInvestmentPolicy('fixed'); renderBacktest()");
  assert.equal(nodes.get('#navRebalanceLegend').hidden, true);
  assert.equal(e.context.fixture.navS.markers.length, 0);
});

test('an unfunded model has no invented NAV or annualized return', () => {
  const r = engine(driftingAssets()).run({ ...driftConfig, initial: 0, monthly: 0 });
  assert.equal(r.final, 0);
  assert.equal(r.nav.length, 0);
  assert.equal(r.xirr, null);
  assert.equal(r.twr, null);
  assert.equal(r.vol, null);
});

function tooltipEngine() {
  const e = engine({ AAA: asset([100, 100, 100, 100, 100, 50]) });
  e.context.fmtPct = (value, digits = 1, sign = false) => value == null || !Number.isFinite(value) ? '—' : (sign && value > 0 ? '+' : '') + (value * 100).toFixed(digits) + '%';
  e.evaluate(section('let bt =', 'const KPI_HELP ='));
  e.evaluate(section('// floating hover card', 'function setMarkers('));
  return e;
}

test('NAV tooltip uses previous monthly close rather than candle open, with fees included in the first month', () => {
  const e = tooltipEngine();
  e.context.strategy = { nav: [{ i: 0, o: 0.99, h: 0.99, l: 0.99, c: 0.99 },
    { i: 5, o: 1.2, h: 1.25, l: 1.08, c: 1.089 }] };
  e.context.benchmark = { nav: [{ i: 0, o: 1, h: 1, l: 1, c: 1 },
    { i: 5, o: 0.96, h: 0.98, l: 0.9, c: 0.95 }] };
  e.evaluate('bt.navS = {}; bt.navMonths = navMonthStats(strategy); bt.benchmarkMonths = navMonthStats(benchmark);');
  close(e.evaluate('bt.navMonths.get("2000-02-01").change'), 0.1);
  close(e.evaluate('bt.navMonths.get("2000-01-01").change'), -0.01);
  const html = e.evaluate('navTooltip({time:"2000-02-01",seriesData:new Map([[bt.navS,{close:1.089}]])})');
  assert.match(html, /本策略当月涨跌<b class="pos">\+10\.00%/);
  assert.match(html, /标普 500 当月涨跌<b class="neg">-5\.00%/);
  assert.match(html, /本策略净值<b>1\.089/);
  assert.match(html, /开<b>1\.200/);
  assert.equal(e.evaluate('navTooltip({time:{year:2000,month:2,day:1},seriesData:new Map([[bt.navS,{close:1.089}]])})'), html);
  assert.match(e.evaluate('navTooltip({time:"2000-01-01",seriesData:new Map([[bt.navS,{close:0.99}]])})'), /-1\.00%/);
  assert.equal(e.evaluate('navTooltip({time:"2000-02-01",seriesData:new Map()})'), null);
  assert.equal(e.evaluate('navTooltip({time:"2001-01-01",seriesData:new Map([[bt.navS,{close:1}]])})'), null);
  e.evaluate('bt.benchmarkMonths = new Map();');
  assert.match(e.evaluate('navTooltip({time:"2000-02-01",seriesData:new Map([[bt.navS,{close:1.089}]])})'), /标普 500 当月涨跌<b class="">—/);
});

test('monthly tooltip returns cannot count a new contribution as investment profit', () => {
  const e = tooltipEngine();
  e.context.result = e.run({ initial: 0, monthly: 1000 });
  assert.equal(e.context.result.final, 1500);
  close(e.evaluate('navMonthStats(result).get("2000-02-01").change'), -0.5);
});

test('chart tooltips hide on mouse exit, outside the chart and missing data', () => {
  const e = tooltipEngine(), events = {}, attributes = {};
  const tip = { hidden: true, style: {}, offsetWidth: 210, setAttribute(name, value) { attributes[name] = value; } };
  const host = { style: {}, append(node) { assert.equal(node, tip); } };
  const element = { id: 'navChart', parentElement: host, clientWidth: 400, clientHeight: 300,
    offsetLeft: 0, offsetTop: 0, setAttribute(name, value) { attributes[name] = value; }, addEventListener(name, fn) { events[name] = fn; } };
  let move;
  e.context.document = { createElement: () => tip };
  e.context.chart = { subscribeCrosshairMove(fn) { move = fn; } };
  e.context.element = element;
  assert.equal(e.evaluate('attachTip(chart,element,param=>param.hasData ? "monthly return" : null)'), tip);
  assert.equal(attributes.role, 'tooltip');
  assert.equal(attributes['aria-describedby'], 'navChartTip');
  move({ time: '2000-02-01', point: { x: 200, y: 100 }, hasData: true });
  assert.equal(tip.hidden, false);
  assert.equal(tip.innerHTML, 'monthly return');
  events.mouseleave(); assert.equal(tip.hidden, true);
  for (const point of [{ x: -1, y: 50 }, { x: 400, y: 50 }, { x: 50, y: 300 }]) {
    tip.hidden = false;
    move({ time: '2000-02-01', point, hasData: true });
    assert.equal(tip.hidden, true);
  }
  move({ time: '2000-02-01', point: { x: 200, y: 100 }, hasData: false });
  assert.equal(tip.hidden, true);
});

test('custom models save and reapply both the sales policy and contribution allocation', () => {
  const e = engine(driftingAssets());
  e.context.S = { ...driftConfig, preset: 'custom-example', start: '2000-01', fee: 0, mode: 'threshold', allowSell: false, cashflow: true };
  e.context.customPresets = [{ key: 'custom-example', name: 'Example', w: { AAA: 50, BBB: 50 }, rule: { mode: 'threshold', abs: 1, rel: 1, period: 'Y' } }];
  const storage = new Map([['heng.templates', JSON.stringify(e.context.customPresets)]]);
  e.context.localStorage = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) };
  e.context.window = {};
  e.context.$ = () => ({ reportValidity: () => true });
  e.context.sumW = () => 100;
  e.context.save = () => true;
  for (const name of ['strategySaveStatus', 'ensureRebalanceState', 'computePresetStats', 'renderPresets', 'renderStrategy', 'renderAssets']) e.context[name] = () => {};
  e.evaluate(section('function saveStrategy(', 'function renderTiers('));
  e.evaluate(section('function applyPreset(', 'let templateDraft ='));
  e.evaluate('saveStrategy()');
  const saved = JSON.parse(storage.get('heng.templates'))[0];
  assert.equal(saved.rule.allowSell, false);
  assert.equal(saved.rule.cashflow, true);
  e.context.S.allowSell = true;
  e.context.S.cashflow = false;
  e.context.saved = saved;
  e.evaluate('applyPreset(saved)');
  assert.equal(e.context.S.allowSell, false);
  assert.equal(e.context.S.cashflow, true);
  e.context.saved.rule = { mode: 'none', cashflow: true, allowSell: true };
  e.evaluate('applyPreset(saved)');
  assert.equal(e.context.S.allowSell, false);
  assert.equal(e.context.S.cashflow, false);
});
