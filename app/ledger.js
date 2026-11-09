// Cash flows are measured in USD for the invested holdings; uninvested cash is excluded.
const Ledger = (() => {
  function changes(before, after, price) {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort().flatMap(id => {
      const quantity = Number(((after[id] || 0) - (before[id] || 0)).toFixed(8));
      if (!quantity) return [];
      return [{id, quantity, price:price(id)}];
    });
  }
  const net = trades => trades.reduce((sum, row) => sum + row.quantity * row.price, 0);
  function open(holdings, date, priceDate, price, cost, legacy) {
    const positions = changes({}, holdings, price);
    return {date, priceDate, positions, cost:cost ?? (positions.length ? null : 0),
      holdings:{...holdings}, entries:[], legacy:legacy && !legacy.example ? {date:legacy.confirmedOn, note:legacy.note} : null};
  }
  function append(book, holdings, entry) {
    book.entries.push(entry);
    book.holdings = {...holdings};
  }
  // Past fills describe positions already in the opening snapshot. Use their
  // cash flows only when the user confirms the entire pre-opening history.
  function pastFlows(book) {
    if (!book.past?.length) return null;
    const quantities = {}, days = new Map();
    for (const fill of book.past) {
      const day = days.get(fill.date) || {flow:0, shares:{}};
      day.flow += fill.flow;
      day.shares[fill.id] = (day.shares[fill.id] || 0) + fill.quantity;
      days.set(fill.date,day);
    }
    for (const date of [...days.keys()].sort()) {
      for (const [id,change] of Object.entries(days.get(date).shares)) {
        quantities[id] = (quantities[id] || 0) + change;
        if (quantities[id] < -1e-8) return null;
      }
    }
    const opening = Object.fromEntries(book.positions.map(row=>[row.id,row.quantity]));
    if (changes(opening,quantities,()=>0).length) return null;
    const flows = [...days.values()].map(day=>day.flow);
    return {invested:flows.reduce((n,x)=>n+Math.max(0,x),0),netPaid:flows.reduce((n,x)=>n+x,0)};
  }
  function summary(book, price) {
    const value = net(changes({}, book.holdings, price));
    const past = book.usePast && pastFlows(book);
    if (!past && book.cost == null) return {value};
    let invested = past ? past.invested : book.cost, netPaid = past ? past.netPaid : book.cost;
    for (const entry of book.entries) {
      netPaid += entry.flow;
      invested += Math.max(0, entry.flow);
    }
    const profit = value - netPaid;
    return {value, invested, netPaid, profit, rate:invested > 0 ? profit / invested : null};
  }
  return {changes,net,open,append,summary,pastFlows};
})();
