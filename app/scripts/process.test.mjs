import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildWeekly } from './process.mjs';
import { TICKERS, fileFor } from './assets.mjs';

function fixture(t, spaceXType = 'EQUITY') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rebalance-prices-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const timestamp = ['2026-06-05', '2026-06-12', '2026-06-19'].map(day => Date.parse(day + 'T14:30:00Z') / 1000);
  for (const symbol of TICKERS) {
    const result = {
      meta: { symbol, longName: symbol === 'SPCX' ? 'Space Exploration Technologies Corp.' : symbol,
        instrumentType: symbol === 'SPCX' ? spaceXType : 'ETF', currency: 'USD', firstTradeDate: timestamp[0], gmtoffset: 0 },
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
