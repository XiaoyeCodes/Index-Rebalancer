// One command to refresh the page's data: node app/scripts/update.mjs
//   1. download daily prices for every ticker (fetch.mjs)
//   2. rebuild the weekly price file (process.mjs) and check it before replacing the old one
//   3. inline it into app/heng.html (build.mjs)
// Pass --skip-fetch to rebuild from the raw files already on disk.
// Exits non-zero, leaving the previous data and page untouched, if any step or check fails.
import fs from 'fs';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { fetchAll } from './fetch.mjs';
import { buildWeekly } from './process.mjs';
import { CHAINS, DATA_FILE } from './assets.mjs';

const MAX_STALE_DAYS = 10;

function check(next, prev) {
  const problems = [];
  if (prev && next.n < prev.n) problems.push(`周数变少了：${prev.n} → ${next.n}`);
  const staleDays = (Date.now() - Date.parse(next.asOf)) / 864e5;
  if (staleDays > MAX_STALE_DAYS) problems.push(`最新交易日是 ${next.asOf}，距今 ${Math.floor(staleDays)} 天，数据源可能没有更新`);
  for (const id of Object.keys(CHAINS)) {
    const a = next.assets[id];
    if (!a) { problems.push(`${id} 缺失`); continue; }
    const len = next.n - a.first;
    for (const k of ['o', 'h', 'l', 'c']) if (a[k].length !== len || a[k].some(v => !(v > 0) || !isFinite(v))) { problems.push(`${id} 的 ${k} 序列有缺口或非正数`); break; }
    // a single-week move beyond these bounds almost always means a bad print or a botched split adjustment
    const limit = id === 'IBIT' ? 0.6 : ['CHINEXT', 'HSTECH'].includes(id) ? 0.45 : 0.35;
    for (let j = Math.max(1, a.c.length - 8); j < a.c.length; j++) {
      const r = a.c[j] / a.c[j - 1] - 1;
      if (Math.abs(r) > limit) { problems.push(`${id} 最近一周涨跌 ${(r * 100).toFixed(0)}%，超过 ${limit * 100}% 的合理范围`); break; }
    }
    if (prev?.assets?.[id] && a.first !== prev.assets[id].first) problems.push(`${id} 的起始周变了：${prev.assets[id].first} → ${a.first}`);
  }
  return problems;
}

function main() {
  const skipFetch = process.argv.includes('--skip-fetch');
  const prev = fs.existsSync(DATA_FILE) ? JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) : null;
  const prevEnd = prev ? (prev.asOf || prev.end || new Date(Date.parse(prev.start) + (prev.n - 1) * 7 * 864e5).toISOString().slice(0, 10)) : '无';

  if (!skipFetch) { console.log('1/3 下载行情…'); fetchAll(); } else console.log('1/3 跳过下载，使用已有原始数据');

  console.log('2/3 生成周线数据并校验…');
  const next = buildWeekly();
  const problems = check(next, prev);
  if (problems.length) throw new Error(`校验未通过，原有数据未改动：\n  ${problems.join('\n  ')}`);
  fs.writeFileSync(DATA_FILE, JSON.stringify(next));

  console.log('3/3 打包页面…');
  execFileSync(process.execPath, [fileURLToPath(new URL('build.mjs', import.meta.url))], { stdio: 'inherit' });

  console.log(`完成：数据从截至 ${prevEnd} 更新到 ${next.asOf}（共 ${next.n} 周）。`);
  console.log(`UPDATED_TO=${next.asOf}`);
}

try { main(); } catch (e) { console.error(e.message); process.exit(1); }
