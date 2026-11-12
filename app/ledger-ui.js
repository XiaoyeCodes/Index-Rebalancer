function holdingChanges() {
  return Ledger.changes(S.ledger?.holdings || {}, S.holdings || {}, px);
}
function formatLedgerMoney(amount) {
  return Number.isFinite(amount) ? usd(Math.abs(amount) < .005 ? 0 : amount) : '—';
}
function ledgerTrades(rows) {
  if (!rows?.length) return '';
  return '<div class="tbl-wrap"><table><thead><tr><th>标的</th><th>操作</th><th class="r">股数</th><th class="r">参考价 · USD</th><th class="r">金额 · USD</th></tr></thead><tbody>' +
    rows.map(r => '<tr><td>'+esc(r.id)+'</td><td>'+(r.quantity>0?'买入':'卖出')+'</td><td class="r">'+Math.abs(r.quantity)+'</td><td class="r">'+formatLedgerMoney(r.price)+'</td><td class="r">'+formatLedgerMoney(Math.abs(r.quantity)*r.price)+'</td></tr>').join('') + '</tbody></table></div>';
}
let ledgerPageNumber = 1;
function ledgerHistoryRecords(book, legacy) {
  const records = (book?.entries || []).slice().reverse().map(value => ({type:'entry',date:value.date || '',value}));
  if (book) records.push({type:'opening',date:book.date || '',value:book});
  for (const value of (book?.past || []).slice().reverse()) records.push({type:'past',date:value.date || '',value});
  if (legacy && !legacy.example) records.push({type:'legacy',date:legacy.date || legacy.confirmedOn || '',value:legacy});
  return records.sort((a,b) => b.date.localeCompare(a.date));
}
function paginateLedgerHistory(records, from = '', to = '', page = 1) {
  const invalid = !!(from && to && from > to);
  const filtered = invalid ? [] : records.filter(row => (!from || row.date >= from) && (!to || row.date && row.date <= to));
  const total = filtered.length, pages = Math.max(1,Math.ceil(total / 10));
  page = Math.max(1,Math.min(pages,Math.trunc(Number(page)) || 1));
  return {rows:filtered.slice((page-1)*10,page*10),total,pages,page,invalid};
}
function ledgerHistoryRow(row) {
  const value = row.value;
  if (row.type === 'entry') return '<details class="ledger-row"><summary><span>'+esc(row.date)+'</span><b>'+esc(value.kind)+'</b><span>净投入 '+formatLedgerMoney(value.flow)+'</span></summary>'+
    '<p class="small muted">'+esc(value.model || '')+' · 参考行情 '+esc(value.priceDate)+(value.kind==='股数核对'?' · 净投入按手动填写金额':' · 金额按确认股数和参考价估算')+'</p>'+ledgerTrades(value.trades)+'</details>';
  if (row.type === 'opening') return '<details class="ledger-row"><summary><span>'+esc(row.date)+'</span><b>期初持仓</b><span>'+(value.usePast?'依据历史成交':value.cost==null?'成本待填写':formatLedgerMoney(value.cost))+'</span></summary><p class="small muted">'+(value.positions.map(r=>esc(r.id)+' '+r.quantity+' 股').join('、') || '从空仓开始')+'</p></details>';
  if (row.type === 'past') return '<details class="ledger-row"><summary><span>'+esc(row.date)+'</span><b>'+esc(value.id)+' · '+(value.quantity>0?'买入':'卖出')+'</b><span>'+formatLedgerMoney(Math.abs(value.flow))+'</span></summary><p class="small muted">手动补录 · '+Math.abs(value.quantity)+' 股 · 含费用 <button class="linkbtn" type="button" data-remove-fill="'+esc(value.key)+'">删除这条补录</button></p></details>';
  return '<div class="ledger-row"><b>'+esc(row.date)+'　旧版操作记录</b><p class="small muted">'+esc(value.note || '已核对持仓')+' 旧版没有保留逐笔金额，此项仅供查阅。</p></div>';
}
function renderLedger() {
  const book = S.ledger;
  const changed = !!book && !S.holdingsExample && holdingChanges().length > 0;
  const real = !S.holdingsExample;
  const totals = book && !changed && real ? Ledger.summary(book, px) : {};
  $('#ledgerProfit').textContent = formatLedgerMoney(totals.profit);
  $('#ledgerRate').textContent = Number.isFinite(totals.rate) ? fmtPct(totals.rate,2,true) : '—';
  $('#ledgerInvested').textContent = formatLedgerMoney(totals.invested);
  $('#ledgerValue').textContent = real ? formatLedgerMoney(Ledger.net(Ledger.changes({},S.holdings,px))) : '—';
  $('#ledgerPeriod').textContent = (book ? '自 '+book.date+' 起记账 · ' : '')+'估值采用 '+D.asOf+' 收盘价';
  $('#ledgerBackfill').hidden = !real;
  $('#ledgerSetup').hidden = !real;
  $('#ledgerSetup').textContent = !book ? '开始记账' : '设置期初成本';
  $('#ledgerAdjust').hidden = !changed;
  $('#ledgerInfo').textContent = !real ? '当前显示示例持仓。请在「本月计划」填入你的实际股数后开始记账。' :
    changed ? '当前股数和账本有差异。请核对这次变动的金额，再查看收益。' :
    !book ? '可以从现有持仓开始，也可以在确认第一笔真实操作时自动建账。' :
    book.usePast ? '' :
    book.cost == null ? '' : window.privateAccount?.sync ? '已确认的买卖会计入共享账本。' : '按清单确认后的买卖会保存在这个浏览器。';
  $('#ledgerInfo').hidden = !$('#ledgerInfo').textContent;
  const legacy = book ? book.legacy : S.lastAppliedOps;
  const records = ledgerHistoryRecords(book,legacy), from = $('#ledgerFrom').value, to = $('#ledgerTo').value;
  const page = paginateLedgerHistory(records,from,to,ledgerPageNumber);
  ledgerPageNumber = page.page;
  $('#ledgerFrom').max = to;
  $('#ledgerTo').min = from;
  $('#ledgerClearDates').disabled = !from && !to;
  $('#ledgerFilterError').hidden = !page.invalid;
  $('#ledgerFrom').setAttribute('aria-invalid',String(page.invalid));
  $('#ledgerTo').setAttribute('aria-invalid',String(page.invalid));
  $('#ledgerList').innerHTML = page.rows.map(ledgerHistoryRow).join('') || '<p class="small muted ledger-empty">'+(page.invalid?'请调整日期范围。':from || to?'该日期范围内没有记账记录。':'还没有已确认的投资记录。')+'</p>';
  $('#ledgerPageStatus').textContent = '共 '+page.total+' 条'+(page.total?' · 第 '+page.page+' / '+page.pages+' 页':'');
  $('#ledgerPrev').disabled = page.page <= 1;
  $('#ledgerNext').disabled = page.page >= page.pages;
  $('#ledgerPastStatus').hidden = !book?.past?.length || !!book.usePast;
  $('#ledgerPastStatus').innerHTML = '';
  if (book?.past?.length && !book.usePast) {
    const past = Ledger.pastFlows(book);
    $('#ledgerPastStatus').innerHTML = '<p class="small muted">'+(past?'补录股数已与期初持仓吻合。确认已录入全部历史买卖后，可以据此计算收益。':'补录流水尚未与期初股数吻合，目前仅供查阅。')+
      (past && !book.usePast?' <button class="btn sm" type="button" id="usePast">使用完整流水计算收益</button>':'')+'</p>';
  }
}
function saveLedgerChange(previous) {
  if (S.ledger) S.ledger.revision = crypto.randomUUID();
  if (save()) return true;
  if ((previous.ledger?.revision || '') === ledgerRevision) S = previous;
  toast('未写入记录，请核对浏览器存储和最新持仓后重试。');
  return false;
}
function bindLedger() {
  const form = $('#ledgerForm'), amount = $('#ledgerAmount');
  for (const id of ['#ledgerFrom','#ledgerTo']) $(id).onchange = () => { ledgerPageNumber=1; renderLedger(); };
  $('#ledgerClearDates').onclick = () => { $('#ledgerFrom').value=''; $('#ledgerTo').value=''; ledgerPageNumber=1; renderLedger(); };
  for (const [id,direction] of [['#ledgerPrev',-1],['#ledgerNext',1]]) $(id).onclick = () => {
    ledgerPageNumber+=direction; renderLedger(); $('#ledgerFilters').scrollIntoView({block:'start'});
  };
  let snapshot;
  function open(adjust) {
    $('#pastTradeForm').hidden=true;
    snapshot = JSON.stringify([opsContext(), S.ledger?.revision, S.holdingsExample]);
    form.dataset.mode = adjust ? 'adjust' : 'opening';
    $('#ledgerLabel').textContent = adjust ? '这次股数变动的净投入（美元）' : '期初持仓总成本（美元）';
    const rows = adjust ? holdingChanges() : S.ledger?.positions || Ledger.changes({},S.holdings,px);
    const estimate = Ledger.net(rows);
    $('#ledgerHelp').textContent = adjust
      ? rows.map(r=>r.id+' '+(r.quantity>0?'+':'')+r.quantity+' 股').join('、')+'。请核对券商金额，净卖出回款请填负数。'
      : '填写开始记账时这批持仓的成本。若只想从建账当天计算，可采用当日参考市值 '+formatLedgerMoney(estimate)+'。';
    amount.value = adjust ? estimate.toFixed(2) : (S.ledger?.cost ?? (rows.length ? '' : 0));
    if (adjust) amount.removeAttribute('min'); else amount.min='0';
    form.hidden=false; amount.focus();
  }
  $('#ledgerSetup').onclick=()=>open(false);
  $('#ledgerAdjust').onclick=()=>open(true);
  $('#ledgerCancel').onclick=()=>{form.hidden=true;};
  const pastForm = $('#pastTradeForm');
  $('#pastSymbol').innerHTML = IDS.map(id=>'<option value="'+esc(id)+'">'+esc(id)+' · '+esc(A[id].cn)+'</option>').join('');
  $('#ledgerBackfill').onclick=()=>{
    form.hidden=true; pastForm.reset();
    $('#pastDate').max=S.ledger?.date || todayStr();
    $('#pastDate').value=$('#pastDate').max;
    pastForm.hidden=false;
  };
  $('#pastCancel').onclick=()=>{pastForm.hidden=true;};
  pastForm.onsubmit=event=>{
    event.preventDefault();
    if (!pastForm.reportValidity()) return;
    const date=$('#pastDate').value, id=$('#pastSymbol').value, side=Number($('#pastSide').value);
    const quantity=side*$('#pastQty').valueAsNumber, flow=side*$('#pastMoney').valueAsNumber;
    withCurrentHoldings(()=>{
      if (pastForm.hidden || S.holdingsExample || !date || date>(S.ledger?.date || todayStr()) || !A[id] || !Number.isFinite(quantity) || !Number.isFinite(flow)) return;
      const previous=structuredClone(S);
      S.ledger ??= Ledger.open(S.holdings,todayStr(),D.asOf,px,null,S.lastAppliedOps);
      (S.ledger.past ??= []).push({key:crypto.randomUUID(),date,id,quantity,flow});
      S.ledger.usePast=false;
      if (saveLedgerChange(previous)) pastForm.hidden=true;
      renderLedger();
    });
  };
  const ledgerAction=event=>{
    const remove=event.target.closest('[data-remove-fill]'), use=event.target.closest('#usePast');
    if (!remove && !use) return;
    withCurrentHoldings(()=>{
      if (!S.ledger?.past) return;
      const previous=structuredClone(S);
      if (use) { if (!Ledger.pastFlows(S.ledger)) return; S.ledger.usePast=true; }
      if (remove) { S.ledger.past=S.ledger.past.filter(row=>row.key!==remove.dataset.removeFill); S.ledger.usePast=false; }
      saveLedgerChange(previous); renderLedger();
    });
  };
  $('#ledgerList').onclick=ledgerAction;
  $('#ledgerPastStatus').onclick=ledgerAction;
  form.onsubmit=event=>{
    event.preventDefault();
    const value=amount.valueAsNumber;
    if (!Number.isFinite(value) || !form.reportValidity()) return;
    withCurrentHoldings(()=>{
      if (S.holdingsExample || snapshot !== JSON.stringify([opsContext(),S.ledger?.revision,S.holdingsExample])) {
        form.hidden=true; renderLedger(); toast('持仓已变化，请重新核对。'); return;
      }
      const previous=structuredClone(S);
      if (form.dataset.mode==='adjust') {
        const trades=holdingChanges();
        if (!trades.length) return;
        Ledger.append(S.ledger,S.holdings,{kind:'股数核对',date:todayStr(),priceDate:D.asOf,model:S.label,trades,flow:value});
      } else if (S.ledger) { S.ledger.cost=value; S.ledger.usePast=false; }
      else S.ledger=Ledger.open(S.holdings,todayStr(),D.asOf,px,value,S.lastAppliedOps);
      saveLedgerChange(previous); form.hidden=true; renderLedger();
    });
  };
}
