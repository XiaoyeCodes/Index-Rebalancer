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
  return { period, pendingReset, operationId, monthlyDone, rebalanceDone, preferredDay, monthlyDate, operationDone, lastBalanceCheck };
})();
