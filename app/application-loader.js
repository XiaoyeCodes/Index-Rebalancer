const bytes = value => Uint8Array.from(atob(value), char => char.charCodeAt(0));

async function storedFile(mode, action) {
  const db = await new Promise((resolve,reject) => {
    const request = indexedDB.open('heng.application.v1',1);
    let expired = false;
    const timer = setTimeout(() => { expired=true;reject(Error('应用缓存不可用')); },1500);
    request.onupgradeneeded = () => request.result.createObjectStore('files',{keyPath:'url'});
    request.onsuccess = () => { clearTimeout(timer);if(expired)request.result.close();else resolve(request.result); };
    request.onerror = () => { clearTimeout(timer);reject(request.error); };
  });
  try {
    return await new Promise((resolve,reject) => {
      const tx = db.transaction('files',mode), request = action(tx.objectStore('files'));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = tx.onerror = () => reject(tx.error || Error('应用缓存不可用'));
    });
  } finally { db.close(); }
}
const browserFiles = globalThis.indexedDB && {open:async () => ({
  match:async url => {const record=await storedFile('readonly',store=>store.get(url));return record ? new Response(record.cipher) : undefined;},
  put:async (url,response) => {const cipher=await response.arrayBuffer();await storedFile('readwrite',store=>store.put({url,cipher,createdAt:Date.now()}));},
  keys:async () => (await storedFile('readonly',store=>store.getAll())).sort((a,b)=>a.createdAt-b.createdAt).map(record=>record.url),
  delete:async url => storedFile('readwrite',store=>store.delete(url)),
})};

// Only authenticated ciphertext is cached; decrypted HTML stays in memory.
export async function loadApplication(access, key, fetcher = fetch, storage = browserFiles) {
  const version = /^[a-f0-9]{64}$/.test(access.appVersion || '') ? access.appVersion : null;
  const url = './application.bin' + (version ? '?v=' + version : '');
  const cacheKey = new URL(url,globalThis.location?.href || 'https://application.invalid/').href;
  let saved;
  if (version && storage) { try { saved = await storage.open('heng.application.v1'); } catch {} }
  async function decrypt(cacheMode) {
    let cached;
    if (saved && cacheMode !== 'reload') { try { cached = await saved.match(cacheKey); } catch {} }
    const response = cached || await fetcher(url, {cache:cacheMode});
    if (!response.ok) throw Error('页面加载失败，请刷新后重试。');
    const cipher = await response.arrayBuffer();
    const plain = await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(access.appIv)}, key, cipher);
    if (saved && !cached) {
      try {
        await saved.put(cacheKey,new Response(cipher,{headers:{'Content-Type':'application/octet-stream'}}));
        // Retain two publications without keeping an unbounded daily download history.
        const keys = await saved.keys();
        for (const old of keys.filter(old=>old!==cacheKey).slice(0,-1)) await saved.delete(old);
      } catch {} // Browser storage limits must not prevent a valid login.
    }
    return plain;
  }
  let plain;
  try { plain = await decrypt(version ? 'force-cache' : 'no-store'); }
  catch (error) {
    if (!version || error.name !== 'OperationError') throw error;
    if (saved) { try { await saved.delete(cacheKey); } catch {} }
    // Recover once if a cached response is damaged or a deployment changed mid-request.
    plain = await decrypt('reload');
  }
  if (!access.appEncoding) return plain; // Older uncompressed publications remain readable.
  if (access.appEncoding !== 'gzip') throw Error('不支持此页面版本，请刷新后重试。');
  return new Response(new Blob([plain]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}
