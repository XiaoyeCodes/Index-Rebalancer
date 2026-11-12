import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../src.html', import.meta.url), 'utf8');
const functions = source.slice(source.indexOf('function paginateBacktestRows('), source.indexOf('/* ---------------- 00 rebalance view'));
function fixture() {
  const nodes = new Map();
  const $ = selector => {
    if (!nodes.has(selector)) nodes.set(selector, { clientWidth: 0, clientHeight: 0, innerHTML: '', textContent: '' });
    return nodes.get(selector);
  };
  const context = vm.createContext({ $, bt: {}, N: 27 * 52, ym: () => '2026-11',
    wDate: i => new Date(Date.UTC(2000, 0, 3) + i * 604800000), ymd: date => date.toISOString().slice(0, 10),
    esc: value => String(value), fmtPct: value => value == null ? '—' : (value * 100).toFixed(1) + '%' });
  vm.runInContext(functions, context);
  return { $, context, evaluate: code => vm.runInContext(code, context) };
}

test('pagination visits every record beyond the old 300-record limit, without duplicates or mutations', () => {
  const f = fixture(), records = Array.from({ length: 503 }, (_, i) => ({ id: i }));
  f.context.records = records;
  const seen = [];
  for (let page = 1; page <= 101; page++) {
    f.context.page = page;
    const result = f.evaluate('paginateBacktestRows(records,page,5)');
    assert.equal(result.pages, 101);
    assert.equal(result.total, 503);
    seen.push(...result.rows.map(row => row.id));
  }
  assert.deepEqual(seen, records.map(row => row.id));
  assert.equal(f.evaluate('paginateBacktestRows(records,999,5).page'), 101);
  assert.equal(f.evaluate('paginateBacktestRows(records,-1,5).page'), 1);
  assert.equal(f.evaluate('paginateBacktestRows([],99,5).page'), 1);
  assert.equal(f.evaluate('paginateBacktestRows([],99,5).pages'), 1);
  assert.equal(f.evaluate('paginateBacktestRows(records.slice(0,3),101,5).page'), 1);
  assert.equal(records[0].id, 0);
  assert.equal(records.at(-1).id, 502);
});

test('page capacity accounts for headers and the tallest wrapped record', () => {
  const f = fixture();
  assert.equal(f.evaluate('backtestPageSize(260,40,[30,45,30])'), 4);
  assert.equal(f.evaluate('backtestPageSize(350,40,[30,45,30])'), 6);
  assert.equal(f.evaluate('backtestPageSize(40,40,[45])'), 1);
});

test('year and trade pages remain independent, retain global bar scales and reset for new results', () => {
  const f = fixture();
  const years = Object.fromEntries(Array.from({ length: 27 }, (_, i) => [String(2000 + i), { s: 1, e: i === 25 ? 2 : 1.25 }]));
  const log = Array.from({ length: 503 }, (_, i) => ({ i, reason: '记录 ' + i, turn: 0.01, trades: [['AAA', 10]] }));
  const result = { years, log, rebCount: log.length, cfg: { allowSell: true, cashflow: true } };
  f.context.result = result; f.context.benchmark = { years };
  const before = JSON.stringify(result);
  f.evaluate('renderYears(result,benchmark); renderLog(result)');
  assert.match(f.$('#yrTable').innerHTML, /2026/);
  assert.match(f.$('#yrTable').innerHTML, /2019/);
  assert.doesNotMatch(f.$('#yrTable').innerHTML, /2018/);
  assert.match(f.$('#logTable').innerHTML, /记录 502/);
  assert.equal(f.$('#yrPrev').disabled, true);
  assert.equal(f.$('#logPrev').disabled, true);
  f.$('#yrNext').onclick();
  assert.match(f.$('#yrTable').innerHTML, /2018/);
  assert.match(f.$('#yrTable').innerHTML, /width:12.5%/);
  assert.match(f.$('#logTable').innerHTML, /记录 502/);
  f.$('#logNext').onclick();
  assert.match(f.$('#logTable').innerHTML, /记录 497/);
  assert.match(f.$('#yrPageStatus').textContent, /第 2 \/ 4 页/);
  f.evaluate('bt.tableViews.log.page=999; drawBacktestRows("log")');
  assert.match(f.$('#logTable').innerHTML, /记录 0</);
  assert.match(f.$('#logPageStatus').textContent, /第 101 \/ 101 页 · 共 503 条/);
  assert.equal(f.$('#logNext').disabled, true);
  assert.equal(f.$('#logCount').textContent, '共 503 次');
  assert.equal(JSON.stringify(result), before);
  f.context.short = { years: { '2026': { s: 1, e: 1.1 } }, log: [], rebCount: 0, cfg: { allowSell: false, cashflow: true } };
  f.evaluate('renderYears(short,benchmark); renderLog(short)');
  assert.equal(f.evaluate('bt.tableViews.years.page'), 1);
  assert.equal(f.evaluate('bt.tableViews.log.page'), 1);
  assert.equal(f.$('#yrPagination').hidden, true);
  assert.equal(f.$('#logPagination').hidden, true);
  assert.match(f.$('#logTable').innerHTML, /没有卖出或存量调仓记录/);
});
