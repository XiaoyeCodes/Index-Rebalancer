import { ASSETS, isHigh } from './assets.js';

// Current vs target for every asset, and the high/low-risk split that drives the beam.
export function analyze(holdings, weights, price, rule) {
  const ids = [...new Set([...Object.keys(weights), ...Object.keys(holdings).filter(id => holdings[id] > 0)])]
    .filter(id => ASSETS[id]);
  const value = Object.fromEntries(ids.map(id => [id, (holdings[id] || 0) * price[id]]));
  const total = ids.reduce((s, id) => s + value[id], 0);
  const wsum = ids.reduce((s, id) => s + (weights[id] || 0), 0) || 1;

  const rows = ids.map(id => {
    const cur = total ? value[id] / total : 0;
    const tgt = (weights[id] || 0) / wsum;
    const dev = cur - tgt;
    const out = Math.abs(dev) * 100 >= rule.abs || (tgt > 0 && Math.abs(dev) / tgt * 100 >= rule.rel) || (tgt === 0 && cur > 0);
    return { id, value: value[id], cur, tgt, dev, out, high: isHigh(id) };
  });

  const side = high => {
    const r = rows.filter(x => x.high === high);
    return { rows: r, cur: r.reduce((s, x) => s + x.cur, 0), tgt: r.reduce((s, x) => s + x.tgt, 0) };
  };
  const hi = side(true), lo = side(false);
  const worst = rows.reduce((m, r) => Math.max(m, Math.abs(r.dev)), 0);
  const outCount = rows.filter(r => r.out).length;
  const status = outCount ? 'out' : worst * 100 >= rule.abs / 2 ? 'drift' : 'level';
  return { rows, total, hi, lo, tilt: hi.cur - hi.tgt, worst, outCount, status };
}

// Shares that bring every asset exactly back to target, keeping the total value
export function rebalanced(a, price) {
  return Object.fromEntries(a.rows.map(r => [r.id, +(a.total * r.tgt / price[r.id]).toFixed(4)]));
}
