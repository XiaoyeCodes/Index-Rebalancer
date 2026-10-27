import './style.css';
import PRICES from 'virtual:prices';
import { ASSETS, PRESETS } from './assets.js';
import { analyze, rebalanced } from './portfolio.js';
import { createBalance } from './scene.js';

const $ = s => document.querySelector(s);
const KEY = 'heng.balance';
const realPrice = Object.fromEntries(Object.entries(PRICES.assets).map(([id, p]) => [id, p.now]));

// Same idea as the app's example: bought at target weights a year ago, left to drift until today
const example = preset => Object.fromEntries(Object.entries(preset.w).map(([id, w]) => [id, +(18000 * w / 100 / PRICES.assets[id].ago).toFixed(3)]));
const fresh = (key = 'balanced') => {
  const p = PRESETS.find(x => x.key === key);
  return { preset: key, holdings: example(p), price: { ...realPrice } };
};

let S;
try { S = JSON.parse(localStorage.getItem(KEY)); } catch (e) { }
if (!S?.holdings || !PRESETS.some(p => p.key === S.preset)) S = fresh();
S.price = { ...realPrice, ...S.price };
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { } };
const preset = () => PRESETS.find(p => p.key === S.preset);

const tip = $('#tip');
const balance = createBalance($('#stage'), {
  onHover(row, x, y) {
    if (!row) { tip.hidden = true; return; }
    const d = row.dev * 100;
    tip.innerHTML = `<b><i style="background:${ASSETS[row.id].color}"></i>${row.id} · ${ASSETS[row.id].cn}</b>`
      + `<span>市值 ${usd(row.value)}</span><span>占比 ${pct(row.cur)} · 目标 ${pct(row.tgt)}</span>`
      + `<span class="${Math.abs(d) < 0.5 ? 'ok' : d > 0 ? 'over' : 'under'}">偏离 ${d > 0 ? '+' : ''}${d.toFixed(1)} pp</span>`;
    const r = $('#stage').getBoundingClientRect();
    tip.style.transform = `translate(${x - r.left + 14}px, ${y - r.top + 14}px)`;
    tip.hidden = false;
  },
  onDragChange(on) { document.body.classList.toggle('dragging', on); },
});

const usd = v => '$' + Math.round(v).toLocaleString('en-US');
const pct = v => (v * 100).toFixed(1) + '%';

$('#asOf').textContent = `价格截至 ${PRICES.asOf}`;
$('#presets').innerHTML = PRESETS.map(p => `<button class="chip" data-key="${p.key}">${p.name}</button>`).join('');

function render() {
  const p = preset();
  const a = analyze(S.holdings, p.w, S.price, p);
  balance.setPortfolio(a);

  document.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c.dataset.key === S.preset));
  const word = { level: ['平衡', '每个标的都在目标附近'], drift: ['轻微偏离', '还在容忍带内，可以用新钱慢慢补'], out: ['需要再平衡', `${a.outCount} 个标的超出容忍带（±${p.abs} pp 或 ±${p.rel}%）`] }[a.status];
  const tiltPp = a.tilt * 100;
  $('#status').className = `status ${a.status}`;
  $('#status').innerHTML = `<div class="badge">${word[0]}</div>
    <div class="total"><small>组合市值</small><b>${usd(a.total)}</b></div>
    <p>${word[1]}。高波动资产占 <b>${pct(a.hi.cur)}</b>，目标 ${pct(a.hi.tgt)}，${Math.abs(tiltPp) < 0.05 ? '两侧持平' : `${tiltPp > 0 ? '左盘偏重' : '右盘偏重'} ${Math.abs(tiltPp).toFixed(1)} pp`}。</p>`;

  const tbody = $('#rows');
  const focused = document.activeElement?.dataset?.id;
  const ids = a.rows.map(r => r.id).join();
  if (tbody.dataset.ids !== ids) {
    tbody.dataset.ids = ids;
    tbody.innerHTML = a.rows.map(r => `<tr data-id="${r.id}">
      <td><i class="dot" style="background:${ASSETS[r.id].color}"></i><b>${r.id}</b><small>${ASSETS[r.id].cn}</small></td>
      <td class="r"><input type="number" min="0" step="0.001" data-id="${r.id}" aria-label="${r.id} 持有股数"></td>
      <td class="r share"><span class="v"></span><span class="bar"><i class="t"></i><i class="c"></i></span></td></tr>`).join('');
  }
  const scaleMax = Math.max(...a.rows.map(r => Math.max(r.cur, r.tgt)), 0.01);
  for (const r of a.rows) {
    const tr = tbody.querySelector(`tr[data-id="${r.id}"]`);
    const inp = tr.querySelector('input');
    if (focused !== r.id) inp.value = +(+S.holdings[r.id] || 0).toFixed(3);
    tr.querySelector('.v').innerHTML = `${pct(r.cur)} <small>/ ${pct(r.tgt)}</small>`;
    tr.querySelector('.t').style.left = `${r.tgt / scaleMax * 100}%`;
    const c = tr.querySelector('.c');
    c.style.width = `${r.cur / scaleMax * 100}%`;
    c.style.background = ASSETS[r.id].color;
    tr.classList.toggle('out', r.out);
  }
  return a;
}

// ---- holdings input: the beam reacts as you type ----
$('#rows').addEventListener('input', e => {
  const id = e.target.dataset.id;
  if (!id) return;
  S.holdings[id] = Math.max(0, +e.target.value || 0);
  $('#ops').textContent = '';
  save(); render();
});

$('#presets').addEventListener('click', e => {
  const key = e.target.closest('.chip')?.dataset.key;
  if (!key || key === S.preset) return;
  // holdings stay as they are; only the targets change, so the beam shows how far you are from the new model
  S.preset = key;
  $('#ops').textContent = '';
  save(); render();
});

// ---- rebalance: trade to target, letting the stacks morph over ~2 s so the beam eases back to level ----
let anim = null;
$('#rebalance').addEventListener('click', () => {
  const a = render();
  const to = rebalanced(a, S.price);
  const from = { ...S.holdings };
  for (const id of Object.keys(from)) if (!(id in to)) to[id] = 0;
  const trades = a.rows.map(r => ({ id: r.id, amt: (to[r.id] - (from[r.id] || 0)) * S.price[r.id] })).filter(t => Math.abs(t.amt) >= 1);
  $('#ops').innerHTML = trades.length
    ? '再平衡操作：' + trades.sort((x, y) => x.amt - y.amt).map(t => `<span class="${t.amt < 0 ? 'sell' : 'buy'}">${t.amt < 0 ? '卖' : '买'} ${t.id} ${usd(Math.abs(t.amt))}</span>`).join('')
    : '已经在目标上，无需操作。';
  cancelAnimationFrame(anim);
  const t0 = performance.now(), D = 2200;
  const step = now => {
    const k = Math.min(1, (now - t0) / D), e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
    for (const id of Object.keys(to)) S.holdings[id] = (from[id] || 0) + (to[id] - (from[id] || 0)) * e;
    render();
    if (k < 1) anim = requestAnimationFrame(step);
    else { for (const id of Object.keys(to)) S.holdings[id] = to[id]; save(); render(); }
  };
  anim = requestAnimationFrame(step);
});

// ---- simulated market week: riskier assets move more, so the beam drifts off level ----
const VOL = { 1: 0.004, 2: 0.012, 3: 0.03, 4: 0.045, 5: 0.07, 6: 0.16 };
const gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
$('#shock').addEventListener('click', () => {
  const market = gauss() * 0.035; // shared equity move, so the high-risk side tends to move together
  for (const id of Object.keys(S.price)) {
    const r = ASSETS[id]?.risk || 3;
    S.price[id] *= Math.exp((r >= 4 ? market : 0) + gauss() * VOL[r]);
  }
  $('#ops').textContent = '';
  save(); render();
});

$('#reset').addEventListener('click', () => {
  cancelAnimationFrame(anim);
  S = fresh(S.preset);
  $('#ops').textContent = '';
  save(); render();
});

render();
