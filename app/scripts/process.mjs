// Turns the raw daily downloads into the weekly, spliced price file the page embeds.
// Each asset gets weekly adjusted OHLC from 2000 in its own currency. Before an ETF existed, the previous ticker in its
// chain is scaled onto it (splice point: 4 weeks after the later ticker's first trading week), oldest link last.
// Weekly USD/CNY and USD/HKD closes are stored alongside so the page can express everything in dollars.
import fs from 'fs';
import { fileURLToPath } from 'url';
import { CHAINS, FX, FX_PEG, fileFor, RAW_DIR, DATA_FILE } from './assets.mjs';

const DAY = 86400000;
// week key = Monday of the bar's local trading date (exchange time), in days since epoch
const wk = (ts, off) => { const d = new Date((ts + off) * 1000); const dow = (d.getUTCDay() + 6) % 7; return Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - dow * DAY) / DAY); };

// Yahoo occasionally misses a share split on Chinese ETFs (e.g. 512800's 1-for-2 in 2025) and leaves one-day bad prints.
// Drop a day that jumps 40%+ and comes straight back, then treat a remaining 40%+ jump close to 1/k or k as a split
// and rescale everything before it. Tickers where Yahoo already reports splits are left alone.
function cleanDaily(ts, q, a, hasSplits) {
  const idx = []; for (let i = 0; i < ts.length; i++) if (q.close[i] > 0 && a[i] > 0) idx.push(i);
  const kill = i => { q.close[i] = null; a[i] = null; };
  for (let n = 1; n + 1 < idx.length; n++) {
    const p = q.close[idx[n - 1]], c = q.close[idx[n]], nx = q.close[idx[n + 1]];
    if (p > 0 && c > 0 && nx > 0 && Math.abs(c / p - 1) > 0.4 && Math.abs(nx / p - 1) < 0.1) kill(idx[n]);
  }
  if (hasSplits) return;
  const live = idx.filter(i => q.close[i] > 0);
  for (let n = 1; n < live.length; n++) {
    const r = q.close[live[n]] / q.close[live[n - 1]]; if (Math.abs(r - 1) < 0.4) continue;
    const k = [2, 3, 4, 5, 10].find(k => Math.abs(r * k - 1) < 0.04 || Math.abs(r / k - 1) < 0.04); if (!k) continue;
    for (let m = 0; m < n; m++) { const i = live[m]; for (const f of ['open', 'high', 'low', 'close']) if (q[f][i] != null) q[f][i] *= r; a[i] *= r; }
  }
}

function load(rawDir, ticker) {
  const j = JSON.parse(fs.readFileSync(new URL(fileFor(ticker), rawDir))).chart.result[0];
  const q = j.indicators.quote[0], a = (j.indicators.adjclose?.[0]?.adjclose || q.close).slice(); const m = new Map();
  const off = j.meta.gmtoffset || 0;
  cleanDaily(j.timestamp, q, a, !!j.events?.splits);
  j.timestamp.forEach((ts, i) => {
    const c = q.close[i], ac = a[i]; if (c == null || ac == null || !(c > 0)) return;
    const f = ac / c; const o = (q.open[i] || c) * f, h = Math.max(q.high[i] || c, c) * f, l = Math.min(q.low[i] || c, c) * f;
    const k = wk(ts, off); const v = m.get(k);
    if (!v) m.set(k, [o, h, l, ac]); else { v[1] = Math.max(v[1], h); v[2] = Math.min(v[2], l); v[3] = ac; }
  });
  return { m, first: j.meta.firstTradeDate, name: j.meta.longName, currency: j.meta.currency, lastTs: j.timestamp.at(-1), off };
}

// splice `older` onto `newer`: weeks before the splice point come from `older`, rescaled to `newer`'s price level
function splice(newer, older) {
  const nw = [...newer.keys()].sort((x, y) => x - y);
  const s = nw[Math.min(4, nw.length - 1)];
  let sp = s; while (!older.has(sp) && sp > nw[0]) sp -= 7;
  if (!older.has(sp)) return { out: newer, week: null };
  const k = newer.get(s)[3] / older.get(sp)[3];
  const out = new Map();
  for (const [w, v] of older) if (w < s) out.set(w, v.map(x => x * k));
  for (const [w, v] of newer) if (w >= s) out.set(w, v);
  return { out, week: s };
}

export function buildWeekly(rawDir = RAW_DIR) {
  // the axis has always begun on the week of 1999-12-27; keep it so week indexes stay stable across rebuilds
  const start = wk(Date.UTC(1999, 11, 27) / 1000, 0);
  let end = 0; const series = {}, meta = {};
  for (const [id, ch] of Object.entries(CHAINS)) {
    const L = ch.map(t => load(rawDir, t)); const A = L.at(-1);
    let out = new Map(A.m); const splices = [];
    for (let n = L.length - 2; n >= 0; n--) { const r = splice(out, L[n].m); if (r.week) { out = r.out; splices.unshift({ ticker: ch[n], until: new Date(r.week * DAY).toISOString().slice(0, 10) }); } }
    series[id] = out;
    meta[id] = {
      actualFirst: new Date(A.first * 1000).toISOString().slice(0, 10), currency: A.currency || 'USD',
      // the page reads proxy/spliceWeek for the most recent splice; `splices` lists every link
      proxy: splices.length ? splices.at(-1).ticker : null, spliceWeek: splices.length ? splices.at(-1).until : null, splices,
      name: A.name,
    };
    end = Math.max(end, ...out.keys());
  }
  const weeks = []; for (let w = start; w <= end; w += 7) weeks.push(w);
  // the last trading day of the reference market (SPY), shown on the page as "数据截至"
  const spy = load(rawDir, 'SPY');
  const asOf = new Date((spy.lastTs + spy.off) * 1000).toISOString().slice(0, 10);
  const data = { asOf, start: new Date(start * DAY).toISOString().slice(0, 10), end: new Date(end * DAY).toISOString().slice(0, 10), n: weeks.length, fx: {}, assets: {} };
  const r5 = x => +x.toPrecision(5);
  for (const [cur, t] of Object.entries(FX)) {
    const m = load(rawDir, t).m; let last = FX_PEG[cur];
    data.fx[cur] = weeks.map(w => { const v = m.get(w); if (v && v[3] > 0) last = v[3]; return r5(last); });
  }
  for (const id in series) {
    const s = series[id]; const first = weeks.findIndex(w => s.has(w)); const o = [], h = [], l = [], c = []; let last = null;
    // a week with no trades (holiday week, or a fund that skipped a week) repeats the previous close
    for (let i = first; i < weeks.length; i++) { const v = s.get(weeks[i]) || (last ? [last[3], last[3], last[3], last[3]] : null); last = v; o.push(r5(v[0])); h.push(r5(v[1])); l.push(r5(v[2])); c.push(r5(v[3])); }
    data.assets[id] = { first, o, h, l, c, ...meta[id] };
  }
  return data;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const data = buildWeekly();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data));
  console.log(`写入 ${data.n} 周，${data.start} 至 ${data.end}`);
}
