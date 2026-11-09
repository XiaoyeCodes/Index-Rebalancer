import { browserModel } from './browser-model.js';

const access = JSON.parse(document.getElementById('access').textContent);
const bytes = value => Uint8Array.from(atob(value), char => char.charCodeAt(0));
const {subtle} = crypto;
const form = document.querySelector('form');
const status = document.getElementById('status');
form.onsubmit = async event => {
  event.preventDefault();
  const button = form.querySelector('button');
  button.disabled = true;
  status.textContent = '正在解锁…';
  try {
    const material = await subtle.importKey('raw', new TextEncoder().encode(form.password.value), 'PBKDF2', false, ['deriveKey']);
    const wrappingKey = await subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt:bytes(access.salt),iterations:access.iterations},material,{name:'AES-GCM',length:256},false,['decrypt']);
    let privateBytes;
    try {
      privateBytes = await subtle.decrypt({name:'AES-GCM',iv:bytes(access.iv)},wrappingKey,bytes(access.sealed));
    } catch { throw Error('密码不正确。'); }
    form.password.value = '';
    const privateKey = await subtle.importKey('pkcs8',privateBytes,{name:'RSA-OAEP',hash:'SHA-256'},false,['unwrapKey']);
    const appKey = await subtle.unwrapKey('raw',bytes(access.wrapped),privateKey,'RSA-OAEP',{name:'AES-GCM',length:256},false,['decrypt']);
    const response = await fetch('./application.bin',{cache:'no-store'});
    if (!response.ok) throw Error('页面加载失败，请刷新后重试。');
    const html = await subtle.decrypt({name:'AES-GCM',iv:bytes(access.appIv)},appKey,await response.arrayBuffer());
    const unlockSeed = await subtle.digest('SHA-256',privateBytes);
    new Uint8Array(privateBytes).fill(0);
    window.privateAccount = {pages:true, model:browserModel(unlockSeed), logout:async () => location.reload()};
    document.open(); document.write(new TextDecoder().decode(html)); document.close();
  } catch (error) {
    status.textContent = error.name === 'OperationError' ? '网页版本已更新，请刷新并重新登录。' : error.message;
    button.disabled = false;
  }
};
