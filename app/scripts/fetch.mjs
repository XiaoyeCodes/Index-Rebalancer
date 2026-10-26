// Downloads daily price history (2000 to today, dividend-adjusted) for every ticker from Yahoo Finance.
// Uses curl rather than Node's fetch so the system proxy (https_proxy) is honoured.
// All files are downloaded into a staging folder first; the raw folder is only replaced when every ticker succeeded.
import fs from 'fs';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { TICKERS, fileFor, RAW_DIR } from './assets.mjs';

const START = Date.UTC(2000, 0, 1) / 1000;
const ATTEMPTS = 4;
const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function download(ticker) {
  const end = Math.floor(Date.now() / 1000) + 86400;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${START}&period2=${end}&interval=1d&events=div,split`;
  let lastError;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const body = execFileSync('curl', ['-sS', '-m', '60', '-A', 'Mozilla/5.0', url], { maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' });
      const json = JSON.parse(body);
      const result = json?.chart?.result?.[0];
      if (!result?.timestamp?.length || !result.indicators?.adjclose?.[0]?.adjclose) throw new Error(json?.chart?.error?.description || 'response has no price data');
      return { body, rows: result.timestamp.length, last: new Date(result.timestamp.at(-1) * 1000).toISOString().slice(0, 10) };
    } catch (e) {
      lastError = e;
      if (attempt < ATTEMPTS) sleep(2000 * attempt);
    }
  }
  throw new Error(`${ticker}: ${String(lastError?.message || lastError).split('\n')[0]}`);
}

export function fetchAll({ log = console.log } = {}) {
  const staging = new URL('../raw-staging/', RAW_DIR);
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  const failures = [];
  for (const t of TICKERS) {
    try {
      const { body, rows, last } = download(t);
      fs.writeFileSync(new URL(fileFor(t), staging), body);
      log(`  ${t.padEnd(8)} ${String(rows).padStart(5)} 天  最新 ${last}`);
    } catch (e) {
      failures.push(e.message);
      log(`  ${t.padEnd(8)} 失败：${e.message}`);
    }
    sleep(600);
  }
  if (failures.length) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw new Error(`${failures.length} 个代码下载失败，原有数据未改动：\n  ${failures.join('\n  ')}`);
  }
  fs.rmSync(RAW_DIR, { recursive: true, force: true });
  fs.renameSync(staging, RAW_DIR);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  try { fetchAll(); console.log('下载完成'); } catch (e) { console.error(e.message); process.exit(1); }
}
