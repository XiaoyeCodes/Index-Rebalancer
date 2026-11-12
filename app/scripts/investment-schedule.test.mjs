import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const Investment=vm.runInNewContext(readFileSync(new URL('../investment.js',import.meta.url),'utf8')+'\nInvestment');
const source=readFileSync(new URL('../src.html',import.meta.url),'utf8');
const completed={investmentDay:11,contributionMonth:'2026-11',lastBalanceCheckDate:'2026-11-11',mode:'hybrid',period:'Q',allowSell:true};

test('completed monthly and quarterly operations show the next regular dates without changing stored state',()=>{
  const before=JSON.stringify(completed),schedule=Investment.nextSchedule(completed,'2026-11-12');
  assert.equal(schedule.monthly.date,'2026-12-11');
  assert.equal(schedule.rebalance.date,'2027-01-01');
  assert.equal(schedule.monthly.done,true);assert.equal(schedule.rebalance.done,true);
  assert.equal(JSON.stringify(completed),before);
});

test('monthly schedules clamp to short months and roll over December',()=>{
  for(const [today,month,expected]of [['2026-01-31','2026-01','2026-02-28'],['2028-01-31','2028-01','2028-02-29'],['2026-12-31','2026-12','2027-01-31']]) {
    assert.equal(Investment.nextSchedule({...completed,investmentDay:31,contributionMonth:month},today).monthly.date,expected);
  }
});

test('a missed monthly plan remains pending and shows today as the next available execution date',()=>{
  const state={investmentDay:11};
  const before=Investment.nextSchedule(state,'2026-11-10').monthly;
  assert.equal(before.date,'2026-11-11');assert.equal(before.overdue,false);
  const after=Investment.nextSchedule(state,'2026-11-12').monthly;
  assert.equal(after.date,'2026-11-12');assert.equal(after.planned,'2026-11-11');assert.equal(after.overdue,true);
});

test('quarterly and annual checks keep missed dates visible until an actual check advances the schedule',()=>{
  const state={mode:'calendar',period:'Q',lastBalanceCheckDate:'2026-07-15'};
  const missed=Investment.nextSchedule(state,'2026-11-12').rebalance;
  assert.equal(missed.date,'2026-10-01');assert.equal(missed.overdue,true);
  assert.equal(Investment.nextSchedule({...state,lastBalanceCheckDate:'2026-11-12'},'2026-11-12').rebalance.date,'2027-01-01');
  const annual={mode:'calendar',period:'Y',lastRebalance:'2025-12-31'};
  assert.equal(Investment.nextSchedule(annual,'2026-01-02').rebalance.date,'2026-01-01');
  assert.equal(Investment.nextSchedule({...annual,lastBalanceCheckDate:'2026-01-02'},'2026-01-02').rebalance.date,'2027-01-01');
});

test('first visits use the calendar cycle without inventing an overdue history or dates for threshold-only rules',()=>{
  assert.equal(Investment.nextSchedule({mode:'calendar',period:'Q'},'2026-02-12').rebalance.date,'2026-04-01');
  const current=Investment.nextSchedule({mode:'calendar',period:'Q'},'2026-07-12').rebalance;
  assert.equal(current.date,'2026-07-01');assert.equal(current.due,true);assert.equal(current.overdue,false);
  assert.equal(Investment.nextSchedule({mode:'threshold'},'2026-11-12').rebalance.date,null);
  assert.equal(Investment.nextSchedule({mode:'none'},'2026-11-12').rebalance.date,null);
});

test('manual reset opportunities keep the regular next-month and next-quarter plans intact',()=>{
  const state={...completed,investmentResets:{monthly:{id:'extra-monthly',period:'2026-11'},rebalance:{id:'extra-check',period:'2026-11'}}};
  const schedule=Investment.nextSchedule(state,'2026-11-12');
  assert.equal(Investment.monthlyDone(state,'2026-11-12'),false);
  assert.equal(schedule.monthly.date,'2026-12-11');assert.equal(schedule.monthly.reset,true);
  assert.equal(schedule.rebalance.date,'2027-01-01');assert.equal(schedule.rebalance.reset,true);
});

function labels(state) {
  const nodes=Object.fromEntries(['nextMonthlyTime','nextMonthlyHint','nextRebalanceTime','nextRebalanceHint'].map(id=>['#'+id,{}]));
  const context=vm.createContext({S:state,Investment,todayStr:()=> '2026-11-12',$:id=>nodes[id],state:{valid:true,rebalancePlan:{thr:false}}});
  vm.runInContext(source.slice(source.indexOf('function renderInvestmentSchedule('),source.indexOf('function renderRebalancePreview('))+'\nrenderInvestmentSchedule(state);',context);
  return Object.fromEntries(Object.entries(nodes).map(([id,node])=>[id,node.textContent]));
}
test('the visible reminders distinguish regular plans, threshold triggers, disabled rules and manual unlocks',()=>{
  assert.equal(labels(completed)['#nextMonthlyTime'],'2026-12-11');
  assert.equal(labels({...completed,mode:'threshold'})['#nextRebalanceTime'],'达到偏离阈值时');
  assert.equal(labels({...completed,mode:'none'})['#nextRebalanceTime'],'未启用再平衡');
  const reset=labels({...completed,investmentResets:{rebalance:{id:'extra',period:'2026-11'}}});
  assert.equal(reset['#nextRebalanceTime'],'2027-01-01');assert.match(reset['#nextRebalanceHint'],/已解锁/);
});
