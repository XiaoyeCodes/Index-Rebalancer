// Only portfolio fields are shared. Keep ledger, holdings and receipts atomic.
const groups = {
  portfolio:'holdings holdingsExample exampleKey beforeExample ledger lastAppliedOps contributionMonth lastExecutionDate lastRebalance'.split(' '),
  strategy:'weights preset label mode abs rel period'.split(' '),
  settings:'monthly initial start fee cashflow allowSell fx fxManual wholeShares investmentDay favorites'.split(' ')
};
const keys = Object.values(groups).flat();
const own = (o,k)=>Object.hasOwn(o,k);
const pick = (o,fields)=>Object.fromEntries(fields.filter(k=>own(o,k)).map(k=>[k,o[k]]));
const canonical = x => x && typeof x==='object' ? (Array.isArray(x)?x.map(canonical):Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])]))) : x;
const equal = (a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const localKey='heng.shared.v1';
const backupKey='heng.shared.backup';
export function localBook() {
  const raw=JSON.parse(localStorage.getItem('heng.state')||'{}');
  const templates=JSON.parse(localStorage.getItem('heng.templates')||'[]');
  return {state:pick(raw,keys),templates:Object.fromEntries(templates.map(t=>[t.key,t]))};
}
export function mergeBook(base,mine,theirs,choice) {
  const conflicts=[];
  function merge(a,b,c,label) {
    if(equal(b,a)||equal(b,c))return c;
    if(equal(a,c))return b;
    conflicts.push(label);return choice==='mine'?b:c;
  }
  const state={};
  for(const [label,fields] of [['持仓与交易记录',groups.portfolio],['当前定投模型',groups.strategy]]) {
    Object.assign(state,merge(pick(base.state,fields),pick(mine.state,fields),pick(theirs.state,fields),label));
  }
  for(const k of groups.settings) {
    const value=merge(base.state[k],mine.state[k],theirs.state[k],'定投设置（'+k+'）');
    if(value!==undefined)state[k]=value;
  }
  const templates={};
  for(const id of new Set([...Object.keys(base.templates),...Object.keys(mine.templates),...Object.keys(theirs.templates)])){
    const value=merge(base.templates[id],mine.templates[id],theirs.templates[id],'模型「'+(mine.templates[id]?.name||theirs.templates[id]?.name||'已删除')+'」');
    if(value!==undefined)templates[id]=value;
  }
  return {book:{state,templates},conflicts};
}
const bytes = s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
function b64(data) {
  let s='';for(let i=0;i<data.length;i+=8192)s+=String.fromCharCode(...data.subarray(i,i+8192));
  return btoa(s);
}
const enc=new TextEncoder();
export async function workspaceSync(endpoint,seed) {
  if(!endpoint)return null;
  const material=await crypto.subtle.importKey('raw',seed,'HKDF',false,['deriveBits','deriveKey']);
  const parameters=label=>({name:'HKDF',hash:'SHA-256',salt:enc.encode('heng.workspace.v1'),info:enc.encode(label)});
  const tokenBits=await crypto.subtle.deriveBits(parameters('access'),material,256);
  const token=Array.from(new Uint8Array(tokenBits),v=>v.toString(16).padStart(2,'0')).join('');
  const key=await crypto.subtle.deriveKey(parameters('content'),material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  async function seal(book) {
    const iv=crypto.getRandomValues(new Uint8Array(12));
    const cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,enc.encode(JSON.stringify(book))));
    const packed=new Uint8Array(12+cipher.length); packed.set(iv);packed.set(cipher,12);return b64(packed);
  }
  async function open(blob) {
    const packed=bytes(blob);
    const data=await crypto.subtle.decrypt({name:'AES-GCM',iv:packed.subarray(0,12)},key,packed.subarray(12));
    const book=JSON.parse(new TextDecoder().decode(data));
    if(!book.state || !book.templates)throw Error('共享账本格式无效');
    return book;
  }
  async function request(suffix,method='GET',body) {
    const headers={Authorization:'Bearer '+token};
    if(body)headers['Content-Type']='application/json';
    const r=await fetch(endpoint+suffix,{method,headers,body:body&&JSON.stringify(body),cache:'no-store',credentials:'omit',redirect:'error',signal:AbortSignal.timeout(12000)});
    if(r.status===409)return null;
    if(!r.ok)throw Error(r.status===401?'共享服务拒绝登录':r.status===413?'账本超过同步容量':'共享服务暂时不可用');
    return r.json();
  }
  let hooks,timer,busy=false,again=false,choice=null,initialize=false,conflictVersion;
  function status(message,action=''){hooks.status(message,action);}
  function schedule(ms=350){clearTimeout(timer);timer=setTimeout(tick,ms);}
  // Apply the server snapshot and its merge baseline as a recoverable transaction.
  function install(book,revision,base) {
    hooks.validate(book);
    const pending={revision,base,install:book};
    localStorage.setItem(localKey,JSON.stringify(pending));
    hooks.apply(book);
    localStorage.setItem(localKey,JSON.stringify({revision,base}));
  }
  async function run() {
    let meta=JSON.parse(localStorage.getItem(localKey)||'null');
    if(meta?.install)install(meta.install,meta.revision,meta.base);
    const remote=await request('?since='+(meta?.revision??-1));
    if(!remote)throw Error('共享版本无效');
    const remoteBook=remote.blob ? await open(remote.blob) : meta?.base;
    if(remoteBook)hooks.validate(remoteBook);
    const mine=localBook();
    if(!remote.revision && !initialize) { status('尚未建立共享账本。请先在保存原始数据的设备上开始共享。','init');return; }
    if(remote.revision && !meta) {
      if((Object.keys(mine.state).length||Object.keys(mine.templates).length)&&!equal(mine,remoteBook)){
        if(choice!=='join'){status('已有共享账本。加入前可下载这台设备的原始记录。','join');return;}
        localStorage.setItem(backupKey,JSON.stringify(mine));
      }
      install(remoteBook,remote.revision,remoteBook);choice=null;initialize=false;status('共享账本已同步');return;
    }
    const empty={state:{},templates:{}};
    const base=meta?.base||empty, theirs=remoteBook||empty;
    if(choice && conflictVersion!==remote.revision)choice=null;
    const merged=mergeBook(base,mine,theirs,choice);
    if(merged.conflicts.length&&!choice) {
      conflictVersion=remote.revision;status('两处同时修改了'+merged.conflicts.join('、')+'，请核对要保留的版本。','conflict');return;
    }
    if(merged.conflicts.length)localStorage.setItem(backupKey,JSON.stringify(choice==='mine'?theirs:mine));
    if(remote.revision && equal(merged.book,theirs)) {
      if(!equal(mine,theirs)||meta?.revision!==remote.revision)install(theirs,remote.revision,theirs);
    } else {
      const blob=await seal(merged.book);
      const result=await request('','PUT',{revision:remote.revision,blob});
      if(!result){again=true;return;}
      // Local edits during fetch are still pending against the just-saved base.
      const after=localBook();
      if(equal(after,merged.book))localStorage.setItem(localKey,JSON.stringify({revision:result.revision,base:merged.book}));
      else if(equal(after,mine))install(merged.book,result.revision,merged.book);
      else {
        const next=mergeBook(mine,after,merged.book);
        if(next.conflicts.length){
          // Keep the original baseline so the next round presents the conflict.
          again=true;return;
        }
        install(next.book,result.revision,merged.book);again=true;
      }
    }
    initialize=false;choice=null;status(again?'正在同步…':'共享账本已同步');
  }
  async function tick(){
    if(!hooks)return;
    if(busy){again=true;return;}
    busy=true;again=false;
    try {if(navigator.locks)await navigator.locks.request('heng.cloud.sync',run);else await run();}
    catch(e){status('尚未同步 · '+(e instanceof TypeError?'网络连接失败':e.message)+'。修改已保留在本机。','retry');}
    finally{busy=false;schedule(again?100:document.hidden?30000:4500);}
  }
  return {
    bind(callbacks){hooks=callbacks;window.addEventListener('online',()=>schedule(0));document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule(0);});schedule(0);},
    changed(){if(hooks){status('有本机修改，正在同步…');schedule();}},
    act(action){if(action==='init')initialize=true;else choice=action; schedule(0);},
    download(previous){const raw=previous?localStorage.getItem(backupKey):JSON.stringify(localBook());if(!raw)return;const url=URL.createObjectURL(new Blob([raw],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='投资账本备份.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  };
}
