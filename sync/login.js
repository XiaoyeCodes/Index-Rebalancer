import { DurableObject } from 'cloudflare:workers';
import credentials from '../app/pages-access.json';
import { loginStore } from './login-store.js';
import { authenticateAttempt, hash } from './login-attempt.js';

const envelope = {iv:credentials.iv,sealed:credentials.sealed};
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
export const loginPaths = new Set(['/auth/visit','/auth/login','/auth/login/v2','/auth/resume','/auth/verify','/auth/logout','/auth/history']);
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

  async attempt(client, payload, kind) {
    return this.ctx.blockConcurrencyWhile(()=>authenticateAttempt(this.store,credentials,client,payload,kind,Date.now()));
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
  if (req.method!=='POST' || !['/auth/visit','/auth/login','/auth/login/v2','/auth/verify'].includes(path)) return answer({},405);
  const {status,payload}=await readJSON(req,2048);
  if (status) return answer({},status);
  if (typeof payload?.device!=='string'||!uuid.test(payload.device)) return answer({},400);
  const ip=req.headers.get('CF-Connecting-IP') || '';
  const client={device:payload.device,ip:/^[0-9a-f:.]{2,45}$/i.test(ip)?ip:'',agent:(req.headers.get('User-Agent')||'').slice(0,240)};
  if (path==='/auth/visit') {
    await guard.visit(client);
    return answer({ok:true});
  }
  if (typeof payload.proof!=='string'||!/^[A-Za-z0-9+/]{43}=$/.test(payload.proof)) return answer({},400);
  const {proof,salt,remember}=payload;
  const attemptId=path==='/auth/login/v2' ? payload.attemptId : undefined;
  if (path==='/auth/login/v2' && (typeof attemptId!=='string'||!uuid.test(attemptId)||typeof remember!=='boolean')) return answer({},400);
  const result=await guard.attempt(client,{proof,salt,remember,attemptId},path==='/auth/verify'?'verify':'login');
  return answer(result.body,result.status,result.body.retryAfter?{'Retry-After':String(result.body.retryAfter)}:{});
}
