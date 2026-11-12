import { DurableObject } from 'cloudflare:workers';
import config from './access.json';
import { githubBackups } from './github-backups.js';

const origin = 'https://xiaoyecodes.github.io';
const maxBytes = 1536 * 1024;
export class SharedBook extends DurableObject {
  constructor(ctx, env) {
    super(ctx,env);
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS book (id INTEGER PRIMARY KEY, rev INTEGER NOT NULL, data TEXT NOT NULL)');
  }
  read(since) {
    const row = this.sql.exec('SELECT rev FROM book WHERE id=1').toArray()[0];
    const revision = row?.rev || 0;
    if (since === revision || !revision) return {revision};
    return {revision, blob:this.sql.exec('SELECT data FROM book WHERE id=1').one().data};
  }
  write(revision, blob) {
    // Each invocation runs synchronously: comparing and advancing the revision
    // never yields to another writer between SQL statements.
    const current = this.sql.exec('SELECT rev FROM book WHERE id=1').toArray()[0]?.rev || 0;
    if (current !== revision) return null;
    this.sql.exec('INSERT OR REPLACE INTO book(id,rev,data) VALUES(1,?,?)',current+1,blob);
    return current+1;
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
    const revision=await book.write(payload.revision,payload.blob);
    return revision===null ? answer({},409) : answer({revision});
  }
};
