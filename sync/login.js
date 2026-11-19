import { DurableObject } from 'cloudflare:workers';
import credentials from '../app/pages-access.json';
import { loginStore } from './login-store.js';

const bytes = value => Uint8Array.from(atob(value),char=>char.charCodeAt(0));
const hex = value => Array.from(new Uint8Array(value),byte=>byte.toString(16).padStart(2,'0')).join('');
const hash = async token => hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)));
const envelope = {iv:credentials.iv,sealed:credentials.sealed};
export const loginPaths = new Set(['/auth/visit','/auth/login','/auth/resume','/auth/verify','/auth/logout','/auth/history']);
export const loginGuard = env => env.LOGIN_GUARD.get(env.LOGIN_GUARD.idFromName('pages-login'));

export class LoginGuard extends DurableObject {
  constructor(ctx, env) {
    super(ctx,env);
    this.store = loginStore(ctx.storage);
  }

  visit(client) { this.store.visit(client,Date.now()); }
  authorized(digest) { return this.store.authorized(digest,credentials.salt,Date.now()); }
  logout(digest) { this.store.logout(digest); }
  history(kind) { return this.store.history(kind,Date.now()); }

  async attempt(client, {proof,salt,remember}, kind) {
    if (salt!==credentials.salt) return {status:409,body:{detail:'登录配置已更新，请刷新网页后重试。'}};
    return this.ctx.blockConcurrencyWhile(async()=>{
      const now=Date.now();
      const blocked=until=>({status:429,body:{detail:'密码错误次数已达上限，请等冷却结束后再试。',retryAfter:Math.ceil((until-now)/1000)}});
      const existing=this.store.check(client,kind,now);
      if (existing) return blocked(existing);

      // The browser performs PBKDF2. This key is a credential and is never logged or stored here.
      const raw=bytes(proof);
      let plaintext;
      try {
        const key=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['decrypt']);
        plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(envelope.iv)},key,bytes(envelope.sealed));
      } catch (error) {
        if (error.name!=='OperationError') throw error;
        const until=this.store.fail(client,kind,now);
        return until ? blocked(until) : {status:401,body:{detail:'密码不正确。'}};
      } finally {
        raw.fill(0);
        if (plaintext) new Uint8Array(plaintext).fill(0);
      }
      if (kind==='verify') {
        this.store.success(client,kind,now);
        return {status:200,body:{ok:true}};
      }
      const token=hex(crypto.getRandomValues(new Uint8Array(32)));
      const expires=now+(remember ? 30*24 : 8)*60*60*1000;
      this.store.success(client,kind,now,{hash:await hash(token),salt,expires});
      return {status:200,body:{...envelope,token}};
    });
  }
}

export async function sessionDigest(req) {
  const token=/^Bearer ([0-9a-f]{64})$/.exec(req.headers.get('Authorization')||'')?.[1];
  return token ? hash(token) : null;
}

export async function loginRequest(req, path, guard, digest, answer, readJSON) {
  if (path==='/auth/resume' && req.method==='GET') return answer(envelope);
  if (path==='/auth/history' && req.method==='GET') {
    const kind=new URL(req.url).searchParams.get('kind') || 'login';
    return ['login','visit','verify'].includes(kind) ? answer({events:await guard.history(kind)}) : answer({},400);
  }
  if (path==='/auth/logout' && req.method==='POST') {
    await guard.logout(digest);
    return answer({ok:true});
  }
  if (req.method!=='POST' || !['/auth/visit','/auth/login','/auth/verify'].includes(path)) return answer({},405);
  const {status,payload}=await readJSON(req,2048);
  if (status) return answer({},status);
  if (typeof payload?.device!=='string'||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(payload.device)) return answer({},400);
  const ip=req.headers.get('CF-Connecting-IP') || '';
  const client={device:payload.device,ip:/^[0-9a-f:.]{2,45}$/i.test(ip)?ip:'',agent:(req.headers.get('User-Agent')||'').slice(0,240)};
  if (path==='/auth/visit') {
    await guard.visit(client);
    return answer({ok:true});
  }
  if (typeof payload.proof!=='string'||!/^[A-Za-z0-9+/]{43}=$/.test(payload.proof)) return answer({},400);
  const result=await guard.attempt(client,payload,path==='/auth/login'?'login':'verify');
  return answer(result.body,result.status,result.body.retryAfter?{'Retry-After':String(result.body.retryAfter)}:{});
}
