import { workspaceSync } from './workspace-sync.js';
import { browserModel } from './browser-model.js';
import { browserSession } from './browser-session.js';
import { derivePagesKey } from './password-check.js';
import { loadApplication } from './application-loader.js';
import { loginTransport } from './login-transport.js';

const access=JSON.parse(document.getElementById('access').textContent);
const request=loginTransport(access.syncEndpoint);
const bytes=value=>Uint8Array.from(atob(value),char=>char.charCodeAt(0));
const {subtle}=crypto;
const form=document.querySelector('form');
const status=document.getElementById('status');
const button=form.querySelector('button');
const session=browserSession();
const deviceKey='heng.login.device.v1';
const device=(()=>{
  const id=crypto.randomUUID();
  try {
    const saved=localStorage.getItem(deviceKey);
    if (/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(saved||'')) return saved;
    localStorage.setItem(deviceKey,id);
  } catch { /* Continue with an ID for this page if storage is unavailable. */ }
  return id;
})();

async function authenticate(action,password,{remember,token}={}) {
  const raw=await derivePagesKey(access,password);
  try {
    const data=await request(action==='login'?'login/v2':action,{token,
      body:{device,salt:access.salt,proof:btoa(String.fromCharCode(...raw)),remember},
      onRetry:()=>busy(true,'连接中断，正在重新连接登录服务…')});
    if (action==='login') data.key=await subtle.importKey('raw',raw,'AES-GCM',false,['decrypt']);
    return data;
  } finally {raw.fill(0);}
}

const cooldownText=seconds=>`密码尝试次数过多，请在约 ${Math.ceil(seconds/60)} 分钟后再试。`;

async function openApplication(key,{token,iv,sealed},remember,restoring=false) {
  let privateKey,unlockSeed;
  const privateBytes=await subtle.decrypt({name:'AES-GCM',iv:bytes(iv)},key,bytes(sealed));
  try {
    privateKey=await subtle.importKey('pkcs8',privateBytes,{name:'RSA-OAEP',hash:'SHA-256'},false,['unwrapKey']);
    unlockSeed=await subtle.digest('SHA-256',privateBytes);
  } finally { new Uint8Array(privateBytes).fill(0); }
  const appKey=await subtle.unwrapKey('raw',bytes(access.wrapped),privateKey,'RSA-OAEP',{name:'AES-GCM',length:256},false,['decrypt']);
  status.textContent='正在加载应用…';
  const html=await loadApplication(access,appKey);
  const model=browserModel(unlockSeed),sync=await workspaceSync(access.syncEndpoint,unlockSeed,token);
  if (!restoring) {
    if (remember) {
      try { await session.save(access,key,token); }
      catch { throw Error('无法保持登录，请允许本站保存数据，或取消“保持登录”后重试。'); }
    } else await session.clear().catch(()=>{});
  }
  window.privateAccount={pages:true,model,sync,device,
    loginHistory:kind=>request('history?kind='+encodeURIComponent(kind),{token}),
    verifyPassword:async password=>{
      try {return await authenticate('verify',password,{token});}
      catch (error) {if (error.retryAfter) throw Error(cooldownText(error.retryAfter)); throw error;}
    },
    logout:async()=>{
      try {await request('logout',{token,body:{}});}catch { /* Forget the local session even if offline. */ }
      await session.clear().catch(()=>{});
      location.reload();
    },
  };
  document.open();document.write(new TextDecoder().decode(html));document.close();
}

function busy(value,message='') {
  button.disabled=form.remember.disabled=value;
  status.textContent=message;
}

function showCooldown(seconds) {
  const until=Date.now()+seconds*1000;
  const update=()=>{
    const remaining=Math.ceil((until-Date.now())/1000);
    if (remaining>0) busy(true,cooldownText(remaining));
    else {clearInterval(timer);busy(false,'冷却已结束，可以重新登录。');}
  };
  const timer=setInterval(update,1000);
  update();
}

form.onsubmit=async event=>{
  event.preventDefault();
  if (button.disabled) return;
  const remember=form.remember.checked,password=form.password.value;
  busy(true,'正在验证密码…');
  try {
    const data=await authenticate('login',password,{remember});
    form.password.value='';
    await openApplication(data.key,data,remember);
  } catch(error) {
    if (error.status===401 || error.status===429) form.password.value='';
    if (error.retryAfter) showCooldown(error.retryAfter);
    else busy(false,error.name==='OperationError'?'网页版本已更新，请刷新后重试。':error.message);
  }
};

async function restoreLogin() {
  busy(true,'正在检查登录状态…');
  try {
    const record=await session.load(access);
    if (!record) {busy(false);return;}
    const envelope=await request('resume',{token:record.token,onRetry:()=>busy(true,'正在重新连接以恢复登录…')});
    await openApplication(record.key,{...envelope,token:record.token},true,true);
  } catch(error) {
    if (error.status===401||error.name==='OperationError') await session.clear().catch(()=>{});
    busy(false,error.status===401?'登录已过期，请重新登录。':error.temporary?error.message:'自动登录未完成，请刷新重试，或输入密码登录。');
  }
}

request('visit',{body:{device},keepalive:true}).catch(()=>{});
restoreLogin();
