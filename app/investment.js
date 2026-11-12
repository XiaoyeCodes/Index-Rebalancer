// Scheduling and receipts are independent of the portfolio allocation algorithm.
const Investment = (() => {
  const period = today => today.slice(0, 7);
  function pendingReset(state, kind, today) {
    const reset = state.investmentResets?.[kind];
    if (!reset || typeof reset.id !== 'string' || !reset.id || reset.period !== period(today)) return null;
    const id = `${kind}:${reset.period}:reset:${reset.id}`;
    return (state.ledger?.entries || []).some(entry => (entry.investmentType === kind && entry.resetId === reset.id) || entry.operationId === id) ? null : reset;
  }
  function operationId(state, intent, today) {
    const reset = pendingReset(state, intent.kind, today);
    return reset ? `${intent.kind}:${period(today)}:reset:${reset.id}` : intent.kind === 'monthly' ? `monthly:${period(today)}` : intent.id;
  }
  function monthlyDone(state, today) {
    if (pendingReset(state, 'monthly', today)) return false;
    const month = period(today);
    return state.contributionMonth === month || (state.ledger?.entries || []).some(entry =>
      entry.operationId === `monthly:${month}` ||
      (entry.investmentType === 'monthly' && entry.period === month) ||
      (!entry.investmentType && ['定投', '定投与再平衡'].includes(entry.kind) && entry.flow > 0 && typeof entry.date === 'string' && entry.date.slice(0, 7) === month));
  }
  function preferredDay(state, today) {
    const latest = (state.ledger?.entries || []).filter(entry => entry.investmentType === 'monthly' && typeof entry.date === 'string').at(-1);
    const fallback = latest?.date || (state.contributionMonth && typeof state.lastExecutionDate === 'string' ? state.lastExecutionDate : null) || today;
    return Math.min(31, Math.max(1, Math.round(Number(state.investmentDay) || +fallback.slice(8))));
  }
  function monthlyDate(state, today, next = monthlyDone(state, today)) {
    const date = new Date(+today.slice(0, 4), +today.slice(5, 7) - 1 + Number(next), 1);
    const year = date.getFullYear(), month = date.getMonth() + 1;
    const day = Math.min(preferredDay(state, today), new Date(year, month, 0).getDate());
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  function rebalanceDone(state, today) {
    if (pendingReset(state, 'rebalance', today)) return false;
    const month = period(today);
    return [state.lastBalanceCheckDate, state.lastRebalance].some(date => typeof date === 'string' && date.slice(0, 7) === month) ||
      (state.ledger?.entries || []).some(entry => (entry.investmentType === 'rebalance' || (!entry.investmentType && entry.kind === '再平衡检查')) &&
        (entry.period === month || (typeof entry.date === 'string' && entry.date.slice(0, 7) === month)));
  }
  function operationDone(state, intent, today) {
    return intent.kind === 'monthly' ? monthlyDone(state, today)
      : (intent.kind === 'rebalance' && rebalanceDone(state, today)) || !!intent.id && (state.ledger?.entries || []).some(entry => entry.operationId === intent.id);
  }
  function lastBalanceCheck(state, includeOpening = true) {
    const legacy = !state.lastAppliedOps?.investmentType;
    return [state.lastBalanceCheckDate, state.lastRebalance, includeOpening ? state.ledger?.date : null,
      ...(state.ledger?.entries || []).filter(entry => entry.investmentType === 'rebalance').map(entry => entry.date),
      legacy ? state.lastAppliedOps?.confirmedOn : null, legacy ? state.lastExecutionDate : null]
      .filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date || '') && Number.isFinite(Date.parse(date))).sort().at(-1);
  }
  function nextSchedule(state, today) {
    // Extra manual opportunities do not move the regular monthly/quarterly/yearly plan.
    const regular = {...state,investmentResets:null};
    const monthlyCompleted = monthlyDone(regular,today), monthlyPlanned = monthlyDate(regular,today,monthlyCompleted);
    const monthly = {date:!monthlyCompleted && monthlyPlanned<today ? today : monthlyPlanned,planned:monthlyPlanned,
      done:monthlyCompleted,overdue:!monthlyCompleted && monthlyPlanned<today,reset:!!pendingReset(state,'monthly',today),day:preferredDay(regular,today)};
    const completed = rebalanceDone(regular,today), reset = !!pendingReset(state,'rebalance',today);
    if (state.mode!=='calendar' && state.mode!=='hybrid') return {monthly,rebalance:{date:null,done:completed,reset,overdue:false,due:false}};
    const last = lastBalanceCheck(regular), anchor = last && last<=today ? last : null;
    const interval = state.period==='Q' ? 3 : 12;
    const base = anchor || today, year = +base.slice(0,4), month = +base.slice(5,7)-1;
    let next = new Date(year,Math.floor(month/interval)*interval+(anchor || completed || month%interval!==0 ? interval : 0),1);
    const dateString = value => `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-01`;
    if (completed && dateString(next)<=today) next = new Date(+today.slice(0,4),Math.floor((+today.slice(5,7)-1)/interval)*interval+interval,1);
    const date = dateString(next);
    return {monthly,rebalance:{date,done:completed,reset,due:date<=today,overdue:!!anchor && !completed && date<today}};
  }
  return { period, pendingReset, operationId, monthlyDone, rebalanceDone, preferredDay, monthlyDate, operationDone, lastBalanceCheck, nextSchedule };
})();
