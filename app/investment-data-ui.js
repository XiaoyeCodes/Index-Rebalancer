function currentInvestmentBook() {
  const raw=JSON.parse(localStorage.getItem('heng.state')||'{}');
  const templates=JSON.parse(localStorage.getItem('heng.templates')||'[]');
  const state=Object.fromEntries(InvestmentData.fields.filter(k=>Object.hasOwn(raw,k)).map(k=>[k,raw[k]]));
  return InvestmentData.validate({state,templates:Object.fromEntries(templates.map(t=>[t.key,t]))},IDS);
}
function paintInvestmentBook() {
  const stored=JSON.parse(localStorage.getItem('heng.state')||'{}');
  S={...structuredClone(defaultState),...migrateExecutionState(stored)};
  ledgerRevision=S.ledger?.revision||'';investmentEpoch=S.investmentEpoch||'';
  const prior=new Map(customPresets.map(p=>[p.key,JSON.stringify(p)]));
  loadTemplates();computePresetStats(customPresets.filter(p=>prior.get(p.key)!==JSON.stringify(p)));
  investmentIntent={kind:'monthly',amountCny:null,period:todayStr().slice(0,7),id:''};
  monthlyDraft=null;ledgerPageNumber=1;
  for(const id of ['#ledgerFrom','#ledgerTo'])$(id).value='';
  for(const id of ['#opsConfirm','#bonusDialog','#ledgerDialog'])if($(id)?.open)$(id).close();
  renderPresets();ensureRebalanceState();renderStrategy();renderAssets();
  if(current==='rebalance')renderRebalance();
  if(current==='history')renderLedger();
  if(current==='backtest')renderBacktest();
  renderResetSettings();
}
function installLocalInvestmentBook(book) {
  book=InvestmentData.validate(book,IDS);
  const before=['heng.state','heng.templates'].map(key=>[key,localStorage.getItem(key)]);
  try {
    localStorage.setItem('heng.state',JSON.stringify(book.state));
    localStorage.setItem('heng.templates',JSON.stringify(Object.values(book.templates)));
  }catch(error){for(const [key,value]of before){if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,value);}throw error;}
  paintInvestmentBook();
}
function downloadInvestmentFile(value,name) {
  const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download=name;link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function bindInvestmentData() {
  const sync=window.privateAccount?.sync,account=window.privateAccount;
  const dialog=$('#investmentDataConfirm'),form=$('#investmentDataForm'),message=$('#investmentDataMessage');
  let pending=null,working=false;
  const say=text=>{$('#investmentDataStatus').textContent=text;};
  const checked=value=>InvestmentData.validate(value,IDS);
  async function importFile(value){return checked(sync?await sync.importBackup(value):value);}
  function describe(book){const s=InvestmentData.summary(book);return `${s.holdings} 个持仓标的 · ${s.records} 条成交／核对记录 · ${s.templates} 个自建模型；每月预算 ¥${s.monthly.toLocaleString()}，计划日 ${s.day} 日。`;}
  function open(mode,book) {
    pending={mode,book,expected:currentInvestmentBook()};
    $('#investmentDataTitle').textContent=mode==='clear'?'清空投资数据？':'恢复备份数据？';
    $('#investmentDataIntro').textContent=mode==='clear'?'将清空投资记录、收益账本、我的持仓及已完成的定投／再平衡记录，保留当前模型、每月预算与计划日。此操作会同步到其他登录设备。':'将用备份中的持仓、投资记录、本月计划及自建模型替换当前投资数据，并同步到其他登录设备。';
    $('#investmentDataPreview').textContent=describe(mode==='clear'?pending.expected:book);
    $('#backupBeforeClearRow').hidden=mode!=='clear';
    $('#backupBeforeClear').checked=!!sync;
    $('#backupBeforeClear').disabled=!sync;
    $('#investmentDataPassword').value='';message.textContent='';
    $('#investmentDataSubmit').textContent=mode==='clear'?'确认清空':'确认恢复';
    $('#investmentDataSubmit').classList.toggle('danger',mode==='clear');
    dialog.showModal();$('#investmentDataPassword').focus();
  }
  async function guarded(action) {
    if(working)return;
    working=true;
    document.querySelectorAll('[data-investment-action]').forEach(button=>button.disabled=true);
    try{await action();}catch(error){say(error.message||'操作未完成，请重试。');}
    finally{working=false;document.querySelectorAll('[data-investment-action]').forEach(button=>button.disabled=button.dataset.cloudOnly==='true'&&!sync);}
  }
  $('#cloudBackupCreate').onclick=()=>guarded(async()=>{
    say('正在加密并保存到 GitHub…');
    const saved=await sync.createBackup(currentInvestmentBook());
    say('已备份到 GitHub，回读校验通过。');
    $('#investmentBackups').hidden=true;
    $('#lastInvestmentBackup').textContent='最近备份：'+new Date(saved.backup.createdAt).toLocaleString('zh-CN');
  });
  $('#investmentBackupDownload').onclick=()=>guarded(async()=>{
    const book=currentInvestmentBook(),value=sync?await sync.exportBackup(book):{...book};
    downloadInvestmentFile(value,'投资数据备份-'+todayStr()+'.json');say('已下载备份，包含持仓、投资记录与本月计划。');
  });
  $('#cloudBackupList').onclick=()=>guarded(async()=>{
    say('正在读取 GitHub 备份…');const {files}=await sync.listBackups(),list=$('#investmentBackups');
    list.replaceChildren();list.hidden=false;
    if(!files.length){say('还没有 GitHub 备份。');return;}
    for(const file of files){
      const row=document.createElement('div');row.className='investment-backup-row';
      const label=document.createElement('span');const n=file.id;
      label.textContent=`${n.slice(0,4)}-${n.slice(4,6)}-${n.slice(6,8)} ${n.slice(9,11)}:${n.slice(11,13)}:${n.slice(13,15)} UTC`;
      for(const [text,action] of [['恢复',async()=>{const raw=await sync.getBackup(file.id);const book=await importFile(raw);open('restore',book);}],['下载',async()=>downloadInvestmentFile(await sync.getBackup(file.id),file.id)]]){
        const button=document.createElement('button');button.type='button';button.className='btn sm';button.textContent=text;button.dataset.investmentAction='';
        button.onclick=()=>guarded(action);row.append(button);
      }
      row.prepend(label);list.append(row);
    }
    say(`共 ${files.length} 份 GitHub 备份，恢复前可核对内容。`);
  });
  $('#investmentBackupImport').onclick=()=>$('#investmentBackupFile').click();
  $('#investmentBackupFile').onchange=event=>guarded(async()=>{
    const file=event.target.files[0];event.target.value='';if(!file)return;
    if(file.size>1536*1024)throw Error('备份文件超过容量。');
    let value;try{value=JSON.parse(await file.text());}catch{throw Error('请选择有效的 JSON 备份文件。');}
    const book=await importFile(value);open('restore',book);
  });
  $('#investmentDataClear').onclick=()=>open('clear');
  $('#investmentDataCancel').onclick=()=>{if(!working)dialog.close();};
  dialog.addEventListener('cancel',event=>{if(working)event.preventDefault();});
  dialog.addEventListener('close',()=>{pending=null;$('#investmentDataPassword').value='';});
  form.onsubmit=async event=>{
    event.preventDefault();if(working||!pending)return;
    working=true;const task=pending,submit=$('#investmentDataSubmit'),cancel=$('#investmentDataCancel');
    submit.disabled=cancel.disabled=true;message.textContent='正在验证密码…';
    let password=$('#investmentDataPassword').value;$('#investmentDataPassword').value='';
    try{
      if(!account?.verifyPassword)throw Error('请在登录后的网页版或本地服务中操作。');
      await account.verifyPassword(password);password='';
      if(JSON.stringify(currentInvestmentBook())!==JSON.stringify(task.expected))throw Error('投资数据已变化，请关闭弹窗后重新核对。');
      if(task.mode==='clear'&&$('#backupBeforeClear').checked){
        if(!sync)throw Error('GitHub备份需要登录网页版。');
        message.textContent='正在备份到 GitHub，校验成功后才会清空…';
        await sync.createBackup(task.expected);
      }
      const epoch=crypto.randomUUID(),next=task.mode==='clear'?InvestmentData.clear(task.expected,epoch):InvestmentData.restore(task.book,epoch);
      message.textContent=task.mode==='clear'?'正在清空并同步…':'正在恢复并同步…';
      if(sync)await sync.replaceBook(next,task.expected);
      else{
        if(JSON.stringify(currentInvestmentBook())!==JSON.stringify(task.expected))throw Error('数据已变化，请重新操作。');
        installLocalInvestmentBook(next);
      }
      dialog.close();say(task.mode==='clear'?'投资数据已清空，持仓与收益记录已归零。':'备份已恢复，持仓、投资记录与本月计划已更新。');
    }catch(error){message.textContent=error.message||'操作未完成，未确认数据已更改。';}
    finally{password='';working=false;submit.disabled=cancel.disabled=false;}
  };
  if(!sync){
    for(const id of ['#cloudBackupCreate','#cloudBackupList'])$(id).disabled=true;
    $('#investmentDataCloudHint').textContent='GitHub加密备份在网页版登录后可用。本地可下载、导入备份及验证密码后清空。';
    window.addEventListener('storage',event=>{if(event.key==='heng.state'&&event.newValue&&(JSON.parse(event.newValue).investmentEpoch||'')!==investmentEpoch)paintInvestmentBook();});
  }
}
