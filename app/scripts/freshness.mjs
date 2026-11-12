import Calendar from '../market-calendar.js';
export function validateSnapshot(next,prev,{now=Date.now()}={}) {
  const problems=[],warnings=[];
  const expected=Calendar.expectedUSDate(now);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(next.asOf)||next.asOf<expected) problems.push(`US close ${next.asOf}; latest expected session ${expected}`);
  if(prev && next.n<prev.n) problems.push('weekly history became shorter');
  if(!next.dates || next.dates.length!==next.n || next.dates.at(-1)!==next.asOf) problems.push('invalid closing-date axis');
  for(const [id,a] of Object.entries(next.assets)) {
    if(!a.asOf || a.asOf>next.asOf) problems.push(`${id}: missing/future closing date`);
    const age=(Date.parse(next.asOf)-Date.parse(a.asOf))/864e5;
    if(a.currency==='USD' && a.asOf!==next.asOf) problems.push(`${id}: US closing date ${a.asOf} differs from reference ${next.asOf}`);
    if(age>14) problems.push(`${id}: stale for ${age} calendar days`);
    else if(age>0) warnings.push(`${id}: ${a.asOf}; verify local holiday or trading suspension`);
    for(const k of ['o','h','l','c']) if(a[k]?.length!==next.n-a.first || a[k].some(p=>!(p>0)||!Number.isFinite(p))) problems.push(`${id}: invalid ${k} history`);
    for(let j=0;j<a.c.length;j++) if(a.h[j]<Math.max(a.o[j],a.c[j]) || a.l[j]>Math.min(a.o[j],a.c[j])) {problems.push(`${id}: inconsistent OHLC`);break;}
    if(prev?.assets[id] && a.first!==prev.assets[id].first) problems.push(`${id}: historical start changed`);
  }
  for(const cur of ['CNY','HKD']) {
    if(next.fx[cur]?.length!==next.n||next.fx[cur].some(p=>!(p>0)||!Number.isFinite(p))) problems.push(`${cur}: invalid exchange-rate history`);
    if(!next.fxAsOf?.[cur] || (Date.parse(next.asOf)-Date.parse(next.fxAsOf[cur]))/864e5>4) problems.push(`${cur}: stale FX close`);
    const expectedFX=[next.asOf,Calendar.expectedFXDate(now)].sort()[0];
    if(next.fxAsOf?.[cur]<expectedFX)problems.push(`${cur}: closing date ${next.fxAsOf[cur]}; expected ${expectedFX}`);
  }
  return {expectedUSDate:expected,problems,warnings};
}
