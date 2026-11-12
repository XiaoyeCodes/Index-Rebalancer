// Export the browser's actual calculations for an independent Python implementation.
// No browser storage, account data or credentials are read.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const source = fs.readFileSync(path.join(root, 'app/src.html'), 'utf8');
const arg = name => process.argv[process.argv.indexOf(name) + 1];
const data = JSON.parse(fs.readFileSync(process.argv.includes('--data') ? arg('--data') : path.join(root, 'app/data/prices-weekly.json'), 'utf8'));
const section = (from, to) => source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)));
const start = Date.parse(data.start + 'T00:00:00Z'), week = 604800000;
const context = vm.createContext({D:data, N:data.n, W0:start, WK:week,
  wDate:i=>new Date(start+i*week), ymd:d=>d.toISOString().slice(0,10),
  ym:i=>(data.dates?.[i] || new Date(start+i*week).toISOString()).slice(0,7)});
vm.runInContext(section('const A = {', '// where each extra asset'), context);
vm.runInContext('const IDS = Object.keys(A);', context);
vm.runInContext(section('const CUR =', '/* ---------------- asset statistics'), context);
vm.runInContext(section('const W20 =', '/* ---------------- charts'), context);
vm.runInContext(section('const PRESETS =', '// Retain older execution receipts'), context);
vm.runInContext(section('function startIndex(', '/* ---------------- 01 assets view'), context);
const output = vm.runInContext(`(() => {
  const scenarios = PRESETS.map(p=>({key:p.key,name:p.name,cfg:{weights:p.w,start:'2000-01',monthly:3000,initial:0,...p.rule,fee:0.05,cashflow:true}}));
  for (const mode of ['none','calendar','threshold','hybrid']) for (const cashflow of [true,false])
    scenarios.push({key:'audit-'+mode+'-'+cashflow,cfg:{weights:{SPY:30,QQQM:20,HSI:15,BND:25,GLD:10},start:'2010-01',monthly:1500,initial:50000,mode,abs:5,rel:30,period:'Q',fee:0.15,cashflow}});
  return {catalogue:A,statistics:ST,presets:PRESETS,scenarios:scenarios.map(s=>({...s,result:backtest(s.cfg)}))};
})()`,context);
const facts=JSON.parse(fs.readFileSync(path.join(root,'app/data/fund-facts.json'),'utf8'));
for(const [id,fact] of Object.entries(facts.funds)) if(output.catalogue[id]?.fee!==fact.fee) throw Error(`${id}: displayed fee differs from the verified issuer record`);
const target = process.argv.includes('--output') ? arg('--output') : path.join(root, '.private/audit/browser.json');
fs.mkdirSync(path.dirname(path.resolve(target)), {recursive:true});
fs.writeFileSync(target,JSON.stringify(output));
console.log(`Exported ${Object.keys(output.statistics).length} assets and ${output.scenarios.length} backtests to ${target}`);
