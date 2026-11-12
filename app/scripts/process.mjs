// Turns the raw daily downloads into the weekly, spliced price file the page embeds.
// Each asset gets weekly adjusted OHLC from 2000 in its own currency. Before an ETF existed, the previous ticker in its
// chain is scaled onto it (splice point: 4 weeks after the later ticker's first trading week), oldest link last.
// Weekly USD/CNY and USD/HKD closes are stored alongside so the page can express everything in dollars.
import fs from 'fs';
import { fileURLToPath } from 'url';
import { CHAINS, FX, FX_PEG, HISTORY_START, fileFor, RAW_DIR, DATA_FILE } from './assets.mjs';

const DAY = 86400000;
const iso = value => new Date(value).toISOString().slice(0, 10);
const formatters = new Map();
export function tradingDate(ts, zone = 'UTC') {
  if(!formatters.has(zone)) formatters.set(zone,new Intl.DateTimeFormat('en-CA', {timeZone:zone, year:'numeric',month:'2-digit',day:'2-digit'}));
  return formatters.get(zone).format(new Date(ts * 1000));
}
// A daily bar is eligible only after its session has finished. Never ingest a live
// Asian quote or an unfinished UTC forex/crypto day into a closing-price snapshot.
export function isClosed(ts, meta, now = Date.now()) {
  const zone = meta.exchangeTimezoneName || 'UTC';
  const day = tradingDate(ts, zone), today = tradingDate(now / 1000, zone);
  if(meta.instrumentType==='CURRENCY'&&new Date(day).getUTCDay()===5)return Date.parse(day)+22.5*3600000<=now;
  if (meta.instrumentType === 'CURRENCY' || meta.instrumentType === 'CRYPTOCURRENCY')
    return Date.parse(day) + DAY + 3600000 <= now;
  if (day !== today) return day < today;
  const parts = new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(now)).split(':').map(Number);
  const close = zone === 'Asia/Shanghai' ? 15 : 16;
  return parts[0] * 60 + parts[1] >= close * 60 + 30;
}
// week key = Monday of the bar's local trading date (exchange time), in days since epoch
const wk = (ts, off) => { const d = new Date((ts + off) * 1000); const dow = (d.getUTCDay() + 6) % 7; return Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - dow * DAY) / DAY); };

// Explicit, auditable corrections for two known vendor defects. Large genuine
// market moves are preserved; no general split-inference heuristic is applied.
function cleanDaily(ts, q, a, ticker, zone) {
  const corrections = [];
  // Constrain known Yahoo defects to the affected securities. Do not infer stock
  // splits from large real stock-market losses (e.g. AAPL in September 2000).
  if (!['512800.SS','510880.SS'].includes(ticker)) return corrections;
  const idx = []; for (let i = 0; i < ts.length; i++) if (q.close[i] > 0 && a[i] > 0) idx.push(i);
  const kill = i => { q.close[i] = null; a[i] = null; };
  for (let n = 1; n + 1 < idx.length; n++) {
    const p = q.close[idx[n - 1]], c = q.close[idx[n]], nx = q.close[idx[n + 1]];
    const day = tradingDate(ts[idx[n]],zone);
    if (ticker === '510880.SS' && day === '2009-11-10' && Math.abs(c / p - 1) > 0.4 && Math.abs(nx / p - 1) < 0.1) {
      kill(idx[n]); corrections.push({date:day,action:'exclude',reason:'isolated invalid Yahoo daily bar; no replacement price invented'});
    }
    if (ticker === '512800.SS' && day === '2025-07-04' && c / p > 1.8 && nx / p < 1.2) {
      for (const f of ['open','high','low','close']) if(q[f][idx[n]] != null) q[f][idx[n]] *= .5;
      a[idx[n]] *= .5;
      corrections.push({date:day,action:'multiply 0.5',reason:'Yahoo inconsistent 1:2 share-split basis',source:'https://www.sse.com.cn/disclosure/fund/announcement/c/new/2025-07-07/512800_20250707_PJ9L.pdf'});
    }
  }
  const live = idx.filter(i => q.close[i] > 0);
  for (let n = 1; n < live.length; n++) {
    const r = q.close[live[n]] / q.close[live[n - 1]]; if (Math.abs(r - 1) < 0.4) continue;
    if (ticker !== '512800.SS' || tradingDate(ts[live[n]],zone) !== '2025-06-30' || Math.abs(r * 2 - 1) >= .04) continue;
    for (let m = 0; m < n; m++) { const i = live[m]; for (const f of ['open', 'high', 'low', 'close']) if (q[f][i] != null) q[f][i] *= .5; a[i] *= .5; }
    corrections.push({before:'2025-06-30',action:'multiply 0.5',reason:'Yahoo partially applied the documented 1:2 split',source:'https://www.sse.com.cn/disclosure/fund/announcement/c/new/2025-07-07/512800_20250707_PJ9L.pdf'});
  }
  return corrections;
}

function load(rawDir, ticker, {now = Date.now(), cutoff = '9999-12-31'} = {}) {
  const j = JSON.parse(fs.readFileSync(new URL(fileFor(ticker), rawDir))).chart.result[0];
  const q = j.indicators.quote[0], a = (j.indicators.adjclose?.[0]?.adjclose || q.close).slice(); const m = new Map();
  const off = j.meta.gmtoffset || 0, zone = j.meta.exchangeTimezoneName || 'UTC';
  const dates = new Map(); let lastDate = null, lastClose = null;
  const since = HISTORY_START[ticker] ? Date.parse(HISTORY_START[ticker]) / 1000 : null;
  if (ticker === 'SPCX' && (j.meta.instrumentType !== 'EQUITY' || !/space\s*(?:x|exploration)/i.test(j.meta.longName || j.meta.shortName || ''))) {
    throw new Error('SPCX 行情不是 SpaceX 股票，停止处理以免混入同代码 ETF 数据');
  }
  const corrections = cleanDaily(j.timestamp, q, a, ticker, zone);
  const eligible = j.timestamp.map((ts,i)=>({ts,i,day:tradingDate(ts,zone)}))
    .filter(({ts,i,day})=>day<=cutoff&&isClosed(ts,j.meta,now)&&q.close[i]>0&&a[i]>0);
  const anchor = eligible.at(-1)?.i;
  const adjustmentScale = anchor == null ? 1 : q.close[anchor]/a[anchor];
  j.timestamp.forEach((ts, i) => {
    if (since != null && ts < since) return;
    const day = tradingDate(ts,zone);
    if (day > cutoff || !isClosed(ts,j.meta,now)) return;
    const c = q.close[i], ac = a[i] == null ? null : a[i]*adjustmentScale; if (c == null || ac == null || !(c > 0)) return;
    const f = ac / c, open = q.open[i] || c;
    const o = open * f, h = Math.max(q.high[i] || c, open, c) * f, l = Math.min(q.low[i] || c, open, c) * f;
    const k = wk(Date.parse(day) / 1000, 0); const v = m.get(k);
    if (!v) m.set(k, [o, h, l, ac]); else { v[1] = Math.max(v[1], h); v[2] = Math.min(v[2], l); v[3] = ac; }
    dates.set(k,day); lastDate = day; lastClose = c;
  });
  if (!m.size) throw new Error(`${ticker}: 没有有效的历史行情`);
  return { m, dates, first: since ?? j.meta.firstTradeDate, name: j.meta.longName, currency: j.meta.currency, lastDate,lastClose,off,corrections,repairs:j.verifiedRepairs||[],historicalReview:j.historicalReconciliations||[] };
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

export function buildWeekly(rawDir = RAW_DIR, {now = Date.now()} = {}) {
  // the axis has always begun on the week of 1999-12-27; keep it so week indexes stay stable across rebuilds
  const start = wk(Date.UTC(1999, 11, 27) / 1000, 0);
  const spy = load(rawDir,'SPY',{now}), asOf = spy.lastDate;
  const options = {now,cutoff:asOf};
  const rates = Object.fromEntries(Object.entries(FX).map(([cur,t])=>[cur,load(rawDir,t,options)]));
  const fxValue = (cur,w) => {
    if(cur === 'USD') return 1;
    const entries = [...rates[cur].m].filter(([k])=>k<=w);
    return entries.length ? entries.at(-1)[1][3] : FX_PEG[cur];
  };
  let end = Math.max(...spy.m.keys()); const series = {}, meta = {};
  for (const [id, ch] of Object.entries(CHAINS)) {
    const L = ch.map(t => load(rawDir, t, options)); const A = L.at(-1);
    const expectedCurrency = /\.SS$|\.SZ$/.test(ch.at(-1)) ? 'CNY' : /\.HK$/.test(ch.at(-1)) ? 'HKD' : 'USD';
    if(A.currency !== expectedCurrency) throw new Error(`${id}: unexpected currency ${A.currency}, expected ${expectedCurrency}`);
    // Convert each proxy into the terminal asset's currency BEFORE level-splicing.
    for(const older of L.slice(0,-1)) if(older.currency !== A.currency)
      older.m = new Map([...older.m].map(([w,v])=>[w,v.map(x=>x/fxValue(older.currency,w)*fxValue(A.currency,w))]));
    let out = new Map(A.m); const splices = [];
    for (let n = L.length - 2; n >= 0; n--) { const r = splice(out, L[n].m); if (r.week) { out = r.out; splices.unshift({ ticker: ch[n], until: new Date(r.week * DAY).toISOString().slice(0, 10) }); } }
    series[id] = out;
    meta[id] = {
      actualFirst: new Date(A.first * 1000).toISOString().slice(0, 10), currency: A.currency || 'USD',
      // the page reads proxy/spliceWeek for the most recent splice; `splices` lists every link
      proxy: splices.length ? splices.at(-1).ticker : null, spliceWeek: splices.length ? splices.at(-1).until : null, splices,
      name: A.name,
      ticker: ch.at(-1), asOf: A.lastDate, lastClose:A.lastClose,
      corrections: L.flatMap((v,i)=>v.corrections.map(c=>({ticker:ch[i],...c}))),
      repairs:A.repairs,
      historicalReview:A.historicalReview,
    };
    end = Math.max(end, ...out.keys());
  }
  const weeks = []; for (let w = start; w <= end; w += 7) weeks.push(w);
  // the last trading day of the reference market (SPY), shown on the page as "数据截至"
  const data = { asOf, statisticsVersion:2, start: iso(start*DAY), end:iso(end*DAY), n:weeks.length,
    dates:weeks.map(w=>spy.dates.get(w)||iso(Math.min((w+4)*DAY,Date.parse(asOf)))), fx: {}, fxAsOf:Object.fromEntries(Object.entries(rates).map(([cur,r])=>[cur,r.lastDate])), assets:{} };
  const r5 = x => +x.toPrecision(10);
  for (const [cur, t] of Object.entries(FX)) {
    const m = rates[cur].m; let last = FX_PEG[cur];
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
