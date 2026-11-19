const lifetime = 30 * 24 * 60 * 60 * 1000;
const storageError = () => Error('无法访问浏览器存储，请检查本站的存储权限。');

function sessionDB() {
  return new Promise((resolve,reject) => {
    let expired = false;
    const timer = setTimeout(() => { expired=true; reject(storageError()); },3000);
    let request;
    try { request=indexedDB.open('heng.pages.login.v1',1); }
    catch { clearTimeout(timer); reject(storageError()); return; }
    request.onupgradeneeded = () => request.result.createObjectStore('sessions');
    request.onsuccess = () => {
      clearTimeout(timer);
      if (expired) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => { clearTimeout(timer); reject(storageError()); };
  });
}
async function profile(mode,action) {
  const db=await sessionDB();
  try {
    return await new Promise((resolve,reject) => {
      const tx=db.transaction('sessions',mode);
      const request=action(tx.objectStore('sessions'),new URL('./',location.href).pathname);
      tx.oncomplete=()=>resolve(request.result);
      tx.onabort=()=>reject(storageError());
      tx.onerror=()=>reject(storageError());
    });
  } finally { db.close(); }
}
const browserStorage = {
  read:()=>profile('readonly',(store,key)=>store.get(key)),
  write:record=>profile('readwrite',(store,key)=>store.put(record,key)),
  clear:()=>profile('readwrite',(store,key)=>store.delete(key)),
};
async function fingerprint(access) {
  // App releases use a new app key; only a password change creates a new salt.
  const data=JSON.stringify([access.iterations,access.salt]);
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(data));
  return Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('');
}
function usableKey(key) {
  return key instanceof CryptoKey && key.type==='secret' && !key.extractable && key.algorithm.name==='AES-GCM' && key.algorithm.length===256 && key.usages.includes('decrypt');
}
const usableToken=token=>typeof token==='string'&&/^[0-9a-f]{64}$/.test(token);
export function browserSession(storage=browserStorage,now=Date.now) {
  return {
    async load(access) {
      const record=await storage.read();
      if (!record) return null;
      if (record.version!==2 || !Number.isFinite(record.createdAt) || !Number.isFinite(record.expiresAt) ||
        record.expiresAt<=now() || record.expiresAt-record.createdAt!==lifetime || !usableKey(record.key) || !usableToken(record.token) ||
        record.fingerprint!==await fingerprint(access)) {
        await storage.clear(); return null;
      }
      return {key:record.key,token:record.token};
    },
    async save(access,key,token) {
      if (!usableKey(key)||!usableToken(token)) throw Error('无法保存此登录凭据。');
      const createdAt=now();
      // IndexedDB clones a non-exportable CryptoKey. Never store the password or raw private key.
      await storage.write({version:2,key,token,createdAt,expiresAt:createdAt+lifetime,fingerprint:await fingerprint(access)});
    },
    clear:()=>storage.clear(),
  };
}
