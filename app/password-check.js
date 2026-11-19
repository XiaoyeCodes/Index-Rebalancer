const bytes = value => Uint8Array.from(atob(value),c=>c.charCodeAt(0));
export async function derivePagesKey(access,password) {
  if(typeof password!=='string'||!password||password.length>512)throw Error('请输入登录密码。');
  const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:bytes(access.salt),iterations:access.iterations},material,256));
}
export async function verifyPagesPassword(access,password) {
  const raw=await derivePagesKey(access,password);
  try {
    const key=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['decrypt']);
    const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(access.iv)},key,bytes(access.sealed));
    new Uint8Array(plaintext).fill(0);
    return true;
  } catch {throw Error('密码不正确，未修改投资数据。');}
  finally {raw.fill(0);}
}
