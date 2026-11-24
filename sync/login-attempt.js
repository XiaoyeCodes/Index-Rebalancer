const bytes = value => Uint8Array.from(atob(value),char=>char.charCodeAt(0));
const hex = value => Array.from(new Uint8Array(value),byte=>byte.toString(16).padStart(2,'0')).join('');
const text = new TextEncoder();
export const hash = async value => hex(await crypto.subtle.digest('SHA-256',text.encode(value)));
const randomHex = () => hex(crypto.getRandomValues(new Uint8Array(32)));

// A receipt holds only a fingerprint and a random nonce. Recovering a session
// also requires the original proof and attempt ID from the identical request.
async function receiptToken(raw, attemptId, nonce) {
  const key=await crypto.subtle.importKey('raw',raw,{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return hex(await crypto.subtle.sign('HMAC',key,text.encode(JSON.stringify(['login-session-v2',attemptId,nonce]))));
}

// The Durable Object serializes the lookup, password check and commit.
export async function authenticateAttempt(store, credentials, client, {proof,salt,remember,attemptId}, kind, now) {
  if (salt!==credentials.salt) return {status:409,body:{detail:'登录配置已更新，请刷新网页后重试。'}};
  const envelope={iv:credentials.iv,sealed:credentials.sealed};
  const failed=until=>until>now
    ? {status:429,body:{detail:'密码错误次数已达上限，请等冷却结束后再试。',retryAfter:Math.ceil((until-now)/1000)}}
    : {status:401,body:{detail:'密码不正确。'}};
  const receiptId=attemptId && await hash(JSON.stringify(['login-receipt-v2',attemptId,client.device,salt,proof,remember]));
  const raw=bytes(proof);
  try {
    const previous=receiptId && store.receipt(receiptId,now);
    if (previous) {
      if (!previous.nonce) return failed(previous.until);
      const token=await receiptToken(raw,attemptId,previous.nonce);
      if (!store.authorized(await hash(token),salt,now)) return {status:401,body:{detail:'登录已过期，请重新登录。'}};
      return {status:200,body:{...envelope,token}};
    }
    const blocked=store.check(client,kind,now,receiptId);
    if (blocked) return failed(blocked);
    try {
      const key=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['decrypt']);
      const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(envelope.iv)},key,bytes(envelope.sealed));
      new Uint8Array(plaintext).fill(0);
    } catch (error) {
      if (error.name!=='OperationError') throw error;
      return failed(store.fail(client,kind,now,receiptId));
    }
    if (kind==='verify') {
      store.success(client,kind,now);
      return {status:200,body:{ok:true}};
    }
    const nonce=receiptId ? randomHex() : null;
    const token=receiptId ? await receiptToken(raw,attemptId,nonce) : randomHex();
    const expires=now+(remember ? 30*24 : 8)*60*60*1000;
    store.success(client,kind,now,{hash:await hash(token),salt,expires},receiptId,nonce);
    return {status:200,body:{...envelope,token}};
  } finally {raw.fill(0);}
}
