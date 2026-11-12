export const InvestmentData = (() => {
  const portfolio = 'holdings holdingsExample exampleKey beforeExample ledger lastAppliedOps contributionMonth lastExecutionDate lastRebalance lastBalanceCheckDate investmentResets investmentEpoch'.split(' ');
  const strategy = 'weights preset label mode abs rel period'.split(' ');
  const settings = 'monthly initial start fee cashflow allowSell fx fxManual wholeShares investmentDay favorites'.split(' ');
  const fields = [...portfolio,...strategy,...settings];
  const object = value => value && typeof value==='object' && !Array.isArray(value);
  const date = value => typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
  const period = value => typeof value==='string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
  const clone = value => JSON.parse(JSON.stringify(value));
  const pick = (value,keys) => Object.fromEntries(keys.filter(key=>Object.hasOwn(value,key)).map(key=>[key,value[key]]));
  function validate(input,ids) {
    const bad = message => {throw Error(message);};
    if (!object(input)||!object(input.state)||!object(input.templates)) bad('备份账本格式无效。');
    if (new TextEncoder().encode(JSON.stringify(input)).length>1024*1024) bad('备份超过1 MB容量。');
    const allowed = new Set(ids), s=input.state;
    const quantities = value => object(value) && Object.entries(value).every(([id,n])=>allowed.has(id)&&Number.isFinite(n)&&n>=0);
    for (const key of ['weights','holdings','beforeExample']) if(s[key]!=null&&!quantities(s[key]))bad('持仓或权重格式无效。');
    if(s.weights && Object.values(s.weights).reduce((n,v)=>n+v,0)>100.00001)bad('模型权重合计不能超过100%。');
    for (const key of ['lastRebalance','lastBalanceCheckDate','lastExecutionDate']) if(s[key]!=null&&!date(s[key]))bad('计划日期无效。');
    if(s.contributionMonth!=null&&!period(s.contributionMonth))bad('定投期次无效。');
    if(s.start!=null&&!period(s.start))bad('回测开始日期无效。');
    for (const key of ['monthly','initial','fee','fx','investmentDay','abs','rel']) if(s[key]!=null&&(!Number.isFinite(s[key])||s[key]<0))bad('定投金额或设置无效。');
    if(s.fx!=null&&s.fx<=0 || s.investmentDay!=null&&(!Number.isInteger(s.investmentDay)||s.investmentDay<1||s.investmentDay>31))bad('汇率或定投日无效。');
    for(const key of ['cashflow','allowSell','fxManual','wholeShares','holdingsExample'])if(s[key]!=null&&typeof s[key]!=='boolean')bad('设置格式无效。');
    for(const key of ['preset','label','exampleKey','investmentEpoch'])if(s[key]!=null&&(typeof s[key]!=='string'||s[key].length>500))bad('投资数据标识无效。');
    if(s.favorites!=null&&(!Array.isArray(s.favorites)||s.favorites.some(id=>!allowed.has(id))))bad('收藏格式无效。');
    if(s.mode!=null&&!['none','threshold','hybrid','calendar'].includes(s.mode))bad('再平衡触发规则无效。');
    if(s.period!=null&&!['M','Q','Y'].includes(s.period))bad('再平衡周期无效。');
    if(s.investmentResets!=null&&(!object(s.investmentResets)||Object.entries(s.investmentResets).some(([kind,r])=>!['monthly','rebalance'].includes(kind)||!object(r)||typeof r.id!=='string'||!r.id||r.id.length>160||!period(r.period))))bad('重置机会格式无效。');
    const rows = (value,kind) => {
      if(!Array.isArray(value)||value.some(r=>!object(r)||!allowed.has(r.id)||!Number.isFinite(r.quantity)||!Number.isFinite(r.price)||r.price<0))bad(kind+'格式无效。');
    };
    if(s.ledger!=null) {
      const book=s.ledger;
      if(!object(book)||!date(book.date)||!quantities(book.holdings)||!Array.isArray(book.entries)||book.cost!=null&&(!Number.isFinite(book.cost)||book.cost<0))bad('投资记录格式无效。');
      rows(book.positions,'期初持仓');
      const seen=new Set();
      for(const entry of book.entries) {
        if(!object(entry)||!Number.isFinite(entry.flow)||!date(entry.date))bad('成交记录格式无效。');
        rows(entry.trades,'成交明细');
        if(entry.investmentType && (!['monthly','bonus','rebalance'].includes(entry.investmentType)||!period(entry.period)||typeof entry.operationId!=='string'||!entry.operationId||seen.has(entry.operationId)))bad('重复或无效的定投记录。');
        if(entry.investmentType)seen.add(entry.operationId);
        if(entry.resetId!=null&&(typeof entry.resetId!=='string'||!entry.resetId||entry.resetId.length>160))bad('重置记录无效。');
      }
      if(book.past!=null&&(!Array.isArray(book.past)||book.past.some(r=>!object(r)||!allowed.has(r.id)||!date(r.date)||!Number.isFinite(r.flow)||!Number.isFinite(r.quantity))))bad('历史成交格式无效。');
    }
    if(s.lastAppliedOps!=null&&(!object(s.lastAppliedOps)||s.lastAppliedOps.confirmedOn&&!date(s.lastAppliedOps.confirmedOn)))bad('执行记录格式无效。');
    for(const [id,p] of Object.entries(input.templates))if(!/^custom-[a-z0-9-]+$/i.test(id)||!object(p)||p.key!==id||typeof p.name!=='string'||!p.name.trim()||p.name.length>200||!quantities(p.w)||Math.abs(Object.values(p.w).reduce((a,b)=>a+b,0)-100)>0.00001)bad('自建模型格式无效。');
    // Never import credentials, conversations, arbitrary localStorage, or sync metadata.
    return clone({state:pick(s,fields),templates:input.templates});
  }
  function clear(book,epoch) {
    const state=clone(book.state);
    for(const key of portfolio)delete state[key];
    state.holdings={};state.holdingsExample=false;state.investmentEpoch=epoch;
    return {state,templates:clone(book.templates)};
  }
  function restore(book,epoch) {const result=clone(book);result.state.investmentEpoch=epoch;return result;}
  function summary(book) {
    return {holdings:Object.values(book.state.holdings||{}).filter(n=>n>0).length,
      records:(book.state.ledger?.entries?.length||0)+(book.state.ledger?.past?.length||0),
      templates:Object.keys(book.templates).length,monthly:book.state.monthly||0,day:book.state.investmentDay||1};
  }
  return {portfolio,strategy,settings,fields,validate,clear,restore,summary};
})();
