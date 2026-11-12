import { DurableObject } from 'cloudflare:workers';
import config from './access.json';
import { githubBackups } from './github-backups.js';
import { bookStore } from './book-store.js';

const origin = 'https://xiaoyecodes.github.io';
const maxBytes = 1536 * 1024;
export class SharedBook extends DurableObject {
  constructor(ctx, env) {
    super(ctx,env);
    this.store=bookStore(ctx.storage);
  }
  read(since) {
    return this.store.read(since);
  }
  write(revision,blob,generation,replace) {
    return this.store.write(revision,blob,generation,replace);
  }
}
export default {
  async fetch(req,env) {
    const headers={'Cache-Control':'no-store','Vary':'Origin'};
    const answer=(data,status=200)=>Response.json(data,{status,headers});
    if (req.headers.get('Origin') && req.headers.get('Origin')!==origin) return answer({},403);
    Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, PUT, POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type'});
    const pathname=new URL(req.url).pathname;
    if(pathname!=='/workspace'&&!/^\/workspace\/backups(?:\/[^/]+)?$/.test(pathname)) return answer({},404);
    if(req.method==='OPTIONS') return new Response(null,{status:204,headers});
    const token = /^Bearer ([0-9a-f]{64})$/.exec(req.headers.get('Authorization')||'')?.[1];
    if(!token) return answer({},401);
    const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
    const expected=Uint8Array.from(config.digest.match(/../g),x=>parseInt(x,16));
    if(!crypto.subtle.timingSafeEqual(hash,expected)) return answer({},401);
    if(pathname.startsWith('/workspace/backups')&&req.method==='GET') {
      try {const result=await githubBackups(req,env);return answer(result.data,result.status);}
      catch(error){return answer({detail:error.message},503);}
    }
    const book=env.BOOKS.get(env.BOOKS.idFromName(env.WORKSPACE_ID || 'portfolio'));
    if(req.method==='GET') {
      const since=new URL(req.url).searchParams.get('since');
      return answer(await book.read(since===null ? -1 : Number(since)));
    }
    if(!(req.method==='PUT'&&pathname==='/workspace')&&!(req.method==='POST'&&pathname==='/workspace/backups')) return answer({},405);
    if(Number(req.headers.get('Content-Length'))>maxBytes) return answer({},413);
    const reader=req.body?.getReader(); if(!reader) return answer({},400);
    const chunks=[];let size=0;
    for (;;) {
      const {done,value}=await reader.read(); if(done) break;
      size+=value.length; if(size>maxBytes){await reader.cancel();return answer({},413);} chunks.push(value);
    }
    let payload;
    try {payload=await new Response(new Blob(chunks)).json();} catch {return answer({},400);}
    if(pathname==='/workspace/backups') {
      try {const result=await githubBackups(req,env,payload);return answer(result.data,result.status);}
      catch(error){return answer({detail:error.message},503);}
    }
    if(!Number.isSafeInteger(payload?.revision)||payload.revision<0||typeof payload.blob!=='string'||!/^[A-Za-z0-9+/=]+$/.test(payload.blob))return answer({},400);
    if(!Number.isSafeInteger(payload.generation)||payload.generation<0)return answer({detail:'网页版本已更新，请刷新后再保存投资数据。'},426);
    if(payload.replace!=null&&typeof payload.replace!=='boolean')return answer({},400);
    const saved=await book.write(payload.revision,payload.blob,payload.generation,payload.replace===true);
    return saved===null ? answer({},409) : answer(saved);
  }
};
