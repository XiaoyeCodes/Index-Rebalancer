// Derive the credential key from a non-exportable profile key and the unlocked site secret.
const defaults = {baseUrl:'https://api.deepseek.com',model:'deepseek-flash'};
function profileDB() {
  return new Promise((resolve,reject) => {
    const request = indexedDB.open('heng.pages.model.v1',1);
    request.onupgradeneeded = () => request.result.createObjectStore('model');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(Error('无法打开浏览器存储，请检查隐私设置。'));
  });
}
async function profile(mode, action) {
  const db = await profileDB();
  try {
    return await new Promise((resolve,reject) => {
      const tx = db.transaction('model',mode);
      const request = action(tx.objectStore('model'));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(Error('无法保存或读取本机配置。'));
    });
  } finally { db.close(); }
}
const read = () => profile('readonly',store => store.get('current'));
function normalURL(value) {
  let url;
  try { url = new URL(value); } catch { throw Error('请输入完整的 HTTPS API 地址。'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw Error('API 地址需要使用 HTTPS，且不能包含账号、查询参数或片段。');
  return url.href.replace(/\/+$/, '');
}
export function browserModel(unlockSeed) {
  async function credentialKey(profileKey) {
    const bytes = await crypto.subtle.sign('HMAC',profileKey,unlockSeed);
    return crypto.subtle.importKey('raw',bytes,'AES-GCM',false,['encrypt','decrypt']);
  }
  async function decode(record) {
    const plain = await crypto.subtle.decrypt({name:'AES-GCM',iv:record.iv},await credentialKey(record.profileKey),record.sealed);
    return JSON.parse(new TextDecoder().decode(plain));
  }
  return {
    async settings() {
      const record = await read();
      if (!record) return {...defaults,configured:false};
      try {
        const {baseUrl,model} = await decode(record);
        return {baseUrl,model,configured:true};
      } catch (error) {
        if (error.name === 'OperationError') return {...defaults,configured:false,reset:true};
        throw error;
      }
    },
    async save({baseUrl,model,key}) {
      baseUrl = normalURL(baseUrl);
      if (!model || model.length>160 || /[\r\n]/.test(model)) throw Error('请输入有效的模型名称。');
      if (!key) {
        const record = await read(), previous = record && await decode(record);
        if (!previous || previous.baseUrl !== baseUrl) throw Error('请为此 API 地址输入你的密钥。');
        key = previous.key;
      }
      if (!/^[\x21-\x7e]+$/.test(key) || key.length>4096) throw Error('API 密钥格式无效。');
      const profileKey = await crypto.subtle.generateKey({name:'HMAC',hash:'SHA-256'},false,['sign']);
      const wrappingKey = await credentialKey(profileKey);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const sealed = await crypto.subtle.encrypt({name:'AES-GCM',iv},wrappingKey,new TextEncoder().encode(JSON.stringify({baseUrl,model,key})));
      await profile('readwrite',store => store.put({profileKey,iv,sealed},'current'));
    },
    clear: () => profile('readwrite',store => store.delete('current')),
    async chat(prompt,signal) {
      const record = await read();
      if (!record) throw Error('请先在设置中填写自己的 API 密钥。');
      const {baseUrl,model,key} = await decode(record);
      let response;
      try {
        response = await fetch(baseUrl+'/chat/completions',{
          method:'POST',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',
          headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},
          body:JSON.stringify({model,messages:[{role:'user',content:prompt}],stream:false}),
          signal:AbortSignal.any([AbortSignal.timeout(120000),...(signal?[signal]:[])])
        });
      } catch (error) {
        if (error.name === 'TypeError') throw Error('无法连接模型服务，请检查网络、API 地址，以及服务是否允许浏览器跨域访问。');
        throw error;
      }
      if (response.status===401 || response.status===403) throw Error('模型服务拒绝了请求，请检查自己的 API 密钥和模型权限。');
      if (response.status===429) throw Error('模型服务限流或额度不足，请检查自己的账户后重试。');
      if (!response.ok) throw Error('模型服务调用失败（'+response.status+'）。请检查 API 地址和模型名称。');
      const data = await response.json(), text = data.choices?.[0]?.message?.content;
      if (typeof text!=='string' || !text.trim()) throw Error('模型没有返回正文。');
      return {text,usage:data.usage};
    }
  };
}
