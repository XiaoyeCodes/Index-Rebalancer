import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildWeekly, isClosed, tradingDate } from './process.mjs';
import { TICKERS, fileFor } from './assets.mjs';

function fixture(t, spaceXType = 'EQUITY') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rebalance-prices-'));
  t.after(() => {assert.equal(path.dirname(directory),fs.realpathSync(os.tmpdir()));assert.ok(path.basename(directory).startsWith('rebalance-prices-'));fs.rmSync(directory, { recursive: true, force: true });});
  const timestamp = ['2026-06-05', '2026-06-12', '2026-06-19'].map(day => Date.parse(day + 'T14:30:00Z') / 1000);
  for (const symbol of TICKERS) {
    const result = {
      meta: { symbol, longName: symbol === 'SPCX' ? 'Space Exploration Technologies Corp.' : symbol,
        instrumentType: symbol === 'SPCX' ? spaceXType : 'ETF', currency: /\.(SS|SZ)$/.test(symbol)?'CNY':symbol.endsWith('.HK')?'HKD':'USD', firstTradeDate: timestamp[0], gmtoffset: 0 },
      timestamp,
      indicators: { quote: [{ open: [100, 110, 120], high: [101, 111, 121], low: [99, 109, 119], close: [100, 110, 120] }],
        adjclose: [{ adjclose: [100, 110, 120] }] },
    };
    fs.writeFileSync(path.join(directory, fileFor(symbol)), JSON.stringify({ chart: { result: [result] } }));
  }
  return pathToFileURL(directory + path.sep);
}

test('SpaceX excludes the previous SPCX security and keeps only its own trading weeks', t => {
  const data = buildWeekly(fixture(t));
  const stock = data.assets.SPCX;
  assert.equal(stock.actualFirst, '2026-06-12');
  assert.equal(new Date(Date.parse(data.start) + stock.first * 7 * 864e5).toISOString().slice(0, 10), '2026-06-08');
  assert.deepEqual(stock.c, [110, 120]);
  assert.equal(stock.proxy, null);
  assert.equal(stock.c.length, data.n - stock.first);
  assert.deepEqual(data.assets.VOO.c, [100, 110, 120]);
});

test('exchange-local dates respect historical DST and unfinished daily sessions are excluded',()=>{
  assert.equal(tradingDate(Date.parse('2026-01-05T04:30Z')/1000,'America/New_York'),'2026-01-04');
  assert.equal(tradingDate(Date.parse('2026-07-05T04:30Z')/1000,'America/New_York'),'2026-07-05');
  const ts=Date.parse('2026-11-12T01:30Z')/1000;
  assert.equal(isClosed(ts,{exchangeTimezoneName:'Asia/Shanghai'},Date.parse('2026-11-12T04:00Z')),false);
  assert.equal(isClosed(ts,{exchangeTimezoneName:'Asia/Shanghai'},Date.parse('2026-11-12T08:00Z')),true);
  assert.equal(isClosed(Date.parse('2026-11-12')/1000,{instrumentType:'CURRENCY',exchangeTimezoneName:'UTC'},Date.parse('2026-11-12T23:59Z')),false);
});
test('the live reference-market day never enters the snapshot',t=>{
  const data=buildWeekly(fixture(t),{now:Date.parse('2026-06-19T15:00:00Z')});
  assert.equal(data.asOf,'2026-06-12');
  assert.deepEqual(data.assets.VOO.c,[100,110]);
  assert.equal(data.dates.at(-1),'2026-06-12');
});

test('snapshot bars are anchored to actual closing dates and rebase adjusted prices at the cutoff', t=>{
  const raw=fixture(t),file=new URL(fileFor('VOO'),raw);
  const response=JSON.parse(fs.readFileSync(file));
  response.chart.result[0].indicators.adjclose[0].adjclose=[50,55,60];
  fs.writeFileSync(file,JSON.stringify(response));
  const data=buildWeekly(raw);
  assert.equal(data.asOf,'2026-06-19');
  assert.equal(data.dates.at(-1),'2026-06-19');
  assert.deepEqual(data.assets.VOO.c,[100,110,120]);
  assert.equal(data.assets.VOO.asOf,data.asOf);
  assert.equal(data.assets.VOO.lastClose,120);
});

test('a USD proxy is converted to HKD before being joined to a Hong Kong ETF',t=>{
  const raw=fixture(t),file=new URL(fileFor('HKD=X'),raw),response=JSON.parse(fs.readFileSync(file));
  for(const k of ['open','high','low','close'])response.chart.result[0].indicators.quote[0][k]=[7,8,9];
  response.chart.result[0].indicators.adjclose[0].adjclose=[7,8,9];
  fs.writeFileSync(file,JSON.stringify(response));
  const a=buildWeekly(raw).assets.HSTECH;
  assert.ok(Math.abs(a.c[0]-100*7/9)<1e-7);
  assert.ok(Math.abs(a.c[1]-110*8/9)<1e-7);
  assert.equal(a.c[2],120);
});

test('the documented bank-ETF split uses an exact factor and preserves genuine returns',t=>{
  const raw=fixture(t),file=new URL(fileFor('512800.SS'),raw),response=JSON.parse(fs.readFileSync(file));
  const r=response.chart.result[0];
  r.timestamp=['2025-06-27','2025-06-30','2025-07-04','2025-07-07'].map(d=>Date.parse(d+'T01:30Z')/1000);
  r.meta.firstTradeDate=r.timestamp[0];
  for(const k of ['open','high','low','close'])r.indicators.quote[0][k]=[1.713,.8555,1.777,.894];
  r.indicators.adjclose[0].adjclose=[1.713,.8555,1.777,.894];
  fs.writeFileSync(file,JSON.stringify(response));
  const a=buildWeekly(raw).assets.BANK;
  assert.deepEqual(a.c.slice(0,3),[.8565,.8885,.894]);
  assert.equal(a.corrections.length,2);
});

test('an ETF response under the SPCX ticker cannot be accepted as SpaceX stock', t => {
  assert.throws(() => buildWeekly(fixture(t, 'ETF')), /SPCX 行情不是 SpaceX 股票/);
});

test('inconsistent vendor high/low prices include the opening price without changing closes', t => {
  const raw = fixture(t);
  const file = new URL(fileFor('600036.SS'), raw);
  const source = JSON.parse(fs.readFileSync(file));
  source.chart.result[0].indicators.quote[0].open[0] = 95;
  fs.writeFileSync(file, JSON.stringify(source));
  const stock = buildWeekly(raw).assets['600036'];
  assert.equal(stock.o[0], 95);
  assert.equal(stock.l[0], 95);
  assert.deepEqual(stock.c, [100, 110, 120]);
});
