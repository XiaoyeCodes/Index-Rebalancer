import { workspaceSync } from './workspace-sync.js';
import { browserModel } from './browser-model.js';
import { browserSession } from './browser-session.js';
import { verifyPagesPassword } from './password-check.js';
import { loadApplication } from './application-loader.js';

const access = JSON.parse(document.getElementById('access').textContent);
const bytes = value => Uint8Array.from(atob(value), char => char.charCodeAt(0));
const {subtle} = crypto;
const form = document.querySelector('form');
const status = document.getElementById('status');
const button = form.querySelector('button');
const session = browserSession();

async function openApplication(wrappingKey,remember,restoring=false) {
  let privateBytes;
  try { privateBytes=await subtle.decrypt({name:'AES-GCM',iv:bytes(access.iv)},wrappingKey,bytes(access.sealed)); }
  catch (error) {
    if (error.name==='OperationError') throw Error('密码不正确。');
    throw error;
  }
  form.password.value='';
  let privateKey,unlockSeed;
  try {
    privateKey=await subtle.importKey('pkcs8',privateBytes,{name:'RSA-OAEP',hash:'SHA-256'},false,['unwrapKey']);
    unlockSeed=await subtle.digest('SHA-256',privateBytes);
  } finally { new Uint8Array(privateBytes).fill(0); }
  const appKey=await subtle.unwrapKey('raw',bytes(access.wrapped),privateKey,'RSA-OAEP',{name:'AES-GCM',length:256},false,['decrypt']);
  status.textContent='正在加载应用…';
  const html=await loadApplication(access,appKey);
  const model=browserModel(unlockSeed),sync=await workspaceSync(access.syncEndpoint,unlockSeed);
  if (!restoring) {
    if (remember) {
      try { await session.save(access,wrappingKey); }
      catch { throw Error('无法保持登录，请允许本站保存数据，或取消“保持登录”后重试。'); }
    }
    else await session.clear().catch(()=>{});
  }
  window.privateAccount={pages:true,model,sync,verifyPassword:password=>verifyPagesPassword(access,password),logout:async()=>{await session.clear();location.reload();}};
  status.textContent='正在打开页面…';
  document.open();document.write(new TextDecoder().decode(html));document.close();
}
function busy(value,message='') {
  button.disabled=form.remember.disabled=value;
  status.textContent=message;
}
form.onsubmit=async event=>{
  event.preventDefault();
  if (button.disabled) return;
  const remember=form.remember.checked;
  busy(true,'正在解锁…');
  try {
    const material=await subtle.importKey('raw',new TextEncoder().encode(form.password.value),'PBKDF2',false,['deriveKey']);
    const key=await subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt:bytes(access.salt),iterations:access.iterations},material,{name:'AES-GCM',length:256},false,['decrypt']);
    await openApplication(key,remember);
  } catch(error) {
    busy(false,error.name==='OperationError'?'网页版本已更新，请刷新后重试。':error.message);
  }
};
async function restoreLogin() {
  busy(true,'正在检查登录状态…');
  let key;
  try {
    key=await session.load(access);
    if (!key) { busy(false); return; }
    status.textContent='正在自动登录…';
    await openApplication(key,true,true);
  } catch(error) {
    if (key && error.message==='密码不正确。') await session.clear().catch(()=>{});
    busy(false,key?'自动登录未完成，请刷新重试，或输入密码登录。':'无法读取已保存的登录状态，请输入密码登录。');
  }
}
restoreLogin();
