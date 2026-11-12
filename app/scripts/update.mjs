// One command to refresh the page's data: node app/scripts/update.mjs
//   1. download daily prices for every ticker (fetch.mjs)
//   2. rebuild the weekly price file (process.mjs) and check it before replacing the old one
//   3. inline it into app/heng.html (build.mjs)
// Pass --skip-fetch to rebuild from the raw files already on disk.
// Pass --git to also commit the new data and page and push them to the tracked remote branch.
// Exits non-zero, leaving the previous data and page untouched, if any step or check fails.
import fs from 'fs';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { fetchAll } from './fetch.mjs';
import { buildWeekly } from './process.mjs';
import { CHAINS, DATA_FILE } from './assets.mjs';
import { validateSnapshot } from './freshness.mjs';
import { crosscheck } from './crosscheck.mjs';
import {repairQuotes} from './repair-quotes.mjs';
import {auditHistory} from './audit-history.mjs';

// Restore every publication input if any build or independent calculation fails.
export async function withRollback(files,action) {
  const backups=files.map(file=>[file,fs.existsSync(file)?fs.readFileSync(file):null]);
  try {return await action();}
  catch(error) {for(const [file,bytes] of backups) {if(bytes===null) fs.rmSync(file,{force:true});else fs.writeFileSync(file,bytes);} throw error;}
}

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

async function main() {
  const skipFetch = process.argv.includes('--skip-fetch');
  const prev = fs.existsSync(DATA_FILE) ? JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) : null;
  const prevEnd = prev ? (prev.asOf || prev.end || new Date(Date.parse(prev.start) + (prev.n - 1) * 7 * 864e5).toISOString().slice(0, 10)) : '无';

  if (!skipFetch) { console.log('1/3 下载行情…'); fetchAll(); } else console.log('1/3 跳过下载，使用已有原始数据');

  const repairFile=new URL('../data/quote-repairs.json',import.meta.url);
  const repaired=await repairQuotes({archive:fs.existsSync(repairFile)?JSON.parse(fs.readFileSync(repairFile,'utf8')):[]});
  console.log(`备用来源核对并填补 ${repaired.applied.length} 个空日线，累计保留 ${repaired.evidence.length} 条证据。`);
  console.log('2/3 生成周线数据并校验…');
  const next = buildWeekly();
  const health = validateSnapshot(next,prev);
  const problems = [...check(next, prev),...health.problems];
  if (problems.length) throw new Error(`校验未通过，原有数据未改动：\n  ${problems.join('\n  ')}`);
  console.log('3/3 与 Nasdaq / Tencent 核对最近三个收盘价，并独立复算…');
  const external=await crosscheck(next);
  const history=await auditHistory(next);
  if(history.failures.length || history.results.some(r=>r.weeklyDifferences.length))throw Error('Historical weekly-close cross-check failed: '+JSON.stringify(history.failures.concat(history.results.filter(r=>r.weeklyDifferences.length))));
  next.health={checkedAt:external.checkedAt,expectedUSDate:health.expectedUSDate,warnings:health.warnings,
    crosscheck:{assets:external.assets,observations:external.observations,sources:['Yahoo Finance','Nasdaq','Tencent Finance','Eastmoney']},
    history:{assets:history.assets,observations:history.observations,weeklyComparisons:history.weeklyComparisons,nonWeeklyDisagreements:history.nonWeeklyDisagreements},
    repairedBars:repaired.evidence.length};
  const html=new URL('../heng.html',import.meta.url),crossFile=new URL('../data/crosscheck.json',import.meta.url),validationFile=new URL('../data/validation.json',import.meta.url);
  const historyFile=new URL('../data/historical-audit.json',import.meta.url),adjustmentFile=new URL('../data/adjustment-check.json',import.meta.url);
  await withRollback([DATA_FILE,html,crossFile,validationFile,repairFile,historyFile,adjustmentFile],async()=>{
    fs.writeFileSync(DATA_FILE,JSON.stringify(next));
    fs.writeFileSync(crossFile,JSON.stringify(external));
    const scratch=new URL('../../.private/data-validation/',import.meta.url);
    fs.mkdirSync(scratch,{recursive:true});
    const exported=fileURLToPath(new URL('browser.json',scratch)), report=fileURLToPath(new URL('reference.json',scratch));
    execFileSync(process.execPath,[fileURLToPath(new URL('audit-export.mjs',import.meta.url)),'--output',exported],{stdio:'inherit'});
    const python=process.env.PYTHON || (process.platform==='win32'?'python':'python3');
    execFileSync(python,[fileURLToPath(new URL('audit-adjustments.py',import.meta.url)),fileURLToPath(new URL('../data/raw/',import.meta.url)),fileURLToPath(adjustmentFile)],{stdio:['ignore','ignore','inherit']});
    const adjustments=JSON.parse(fs.readFileSync(adjustmentFile,'utf8'));
    next.health.adjustments={tickers:adjustments.tickers,dailyRows:adjustments.dailyRows,maxRelativeFactorDifference:Math.max(...adjustments.results.map(r=>r.maxRelativeFactorDifference))};
    execFileSync(python,[fileURLToPath(new URL('audit-data.py',import.meta.url)),fileURLToPath(DATA_FILE),exported,report],{stdio:'inherit'});
    const reference=JSON.parse(fs.readFileSync(report,'utf8'));
    next.health.calculations={assets:reference.assets,backtests:reference.backtests,weeklyBalances:reference.weeklyBalances,yearlyChecks:reference.yearlyChecks,monthlyWeightChecks:reference.monthlyWeightChecks,maxAbsoluteErrors:reference.maxAbsoluteErrors};
    fs.writeFileSync(DATA_FILE,JSON.stringify(next));
    fs.writeFileSync(validationFile,JSON.stringify(reference));
    fs.writeFileSync(repairFile,JSON.stringify(repaired.evidence));
    fs.writeFileSync(historyFile,JSON.stringify(history));
    execFileSync(process.execPath,[fileURLToPath(new URL('build.mjs', import.meta.url))],{stdio:'inherit'});
  });

  console.log(`完成：数据从截至 ${prevEnd} 更新到 ${next.asOf}（共 ${next.n} 周）。`);
  console.log(`UPDATED_TO=${next.asOf}`);
  if (process.argv.includes('--git')) commitAndPush(next.asOf);
}

// --git: commit only the regenerated data and page, then push. Never touches other changes in the working tree.
function commitAndPush(asOf) {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const files = ['app/data/prices-weekly.json','app/heng.html','app/data/crosscheck.json','app/data/validation.json','app/data/quote-repairs.json','app/data/historical-audit.json','app/data/adjustment-check.json'];
  // never let git or the credential manager stop to ask for input during an unattended run
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
  const git = (...args) => execFileSync('git', args, { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  console.log('4/4 提交并推送到 GitHub…');
  if (!git('status', '--porcelain', '--', ...files)) { console.log('数据没有变化，无需提交。'); console.log('GIT=unchanged'); return; }
  git('add', '--', ...files);
  git('commit', '-m', `Validate and refresh market data through ${asOf}`, '--', ...files);
  const sha = git('rev-parse', '--short', 'HEAD');
  try { git('push'); }
  catch (e) {
    console.log(`GIT=committed ${sha}`);
    throw new Error(`已在本地提交 ${sha}，但推送失败（数据和页面已更新）：${String(e.stderr || e.message).trim().split('\n').slice(-2).join(' ')}`);
  }
  console.log(`已提交并推送 ${sha}。`);
  console.log(`GIT=pushed ${sha}`);
}

if(process.argv[1] && fileURLToPath(import.meta.url)===fs.realpathSync(process.argv[1])) {
  try {await main();} catch(e) {console.error(e.message);process.exitCode=1;}
}
