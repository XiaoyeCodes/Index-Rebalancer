const bytes = value => Uint8Array.from(atob(value),c=>c.charCodeAt(0));
export async function verifyPagesPassword(access,password) {
  if(typeof password!=='string'||!password||password.length>512)throw Error('请输入登录密码。');
  const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);
  const key=await crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt:bytes(access.salt),iterations:access.iterations},material,{name:'AES-GCM',length:256},false,['decrypt']);
  try {
    const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(access.iv)},key,bytes(access.sealed));
    new Uint8Array(plaintext).fill(0);
    return true;
  } catch {throw Error('密码不正确，未修改投资数据。');}
}
