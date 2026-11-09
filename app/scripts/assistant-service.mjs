import { modelSettings } from './vault.mjs';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const runtime = fileURLToPath(new URL('../../assistant/services/vibe-trading/', import.meta.url));
const data = process.env.HENG_ASSISTANT_DATA || path.join(process.env.LOCALAPPDATA || os.homedir(), 'DynamicRebalancing', 'assistant');
const token = randomBytes(32).toString('hex');
let ready, worker;
const fail = (status, message) => Object.assign(new Error(message), { status });

async function availablePort() {
  const socket = createServer();
  await new Promise((resolve, reject) => socket.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}
async function startEngine() {
  const python = path.join(runtime, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  if (!existsSync(python)) throw fail(503, '研究引擎尚未安装，请在 assistant 目录运行 npm run research:setup。');
  mkdirSync(data, {recursive:true});
  const port = await availablePort();
  const env = {...process.env, SPARKFLOW_USER_DATA_DIR:data, SPARKFLOW_VIBE_ENV_FILE:path.join(data, 'model.env'),
    API_AUTH_KEY:token, ENABLE_SESSION_RUNTIME:'true', VIBE_TRADING_ENABLE_SHELL_TOOLS:'false', PYTHONUTF8:'1',
    LANGSMITH_TRACING:'false', LANGCHAIN_TRACING_V2:'false'};
  const {key,model,baseUrl} = modelSettings();
  Object.assign(env,{LANGCHAIN_PROVIDER:'deepseek', LANGCHAIN_MODEL_NAME:model, DEEPSEEK_API_KEY:key, DEEPSEEK_BASE_URL:baseUrl});
  const child = spawn(python, ['-m','uvicorn','api_server:app','--host','127.0.0.1','--port',String(port),'--no-access-log'],
    {cwd:path.join(runtime,'agent'),env,windowsHide:true,stdio:'ignore'});
  worker = child;
  child.once('error', () => { if (worker === child) worker = undefined; });
  child.once('exit', () => { if (worker === child) { worker = undefined; ready = undefined; } });
  const base = 'http://127.0.0.1:' + port;
  for (let i=0; i<150 && worker===child; i++) {
    try { if ((await fetch(base + '/live',{signal:AbortSignal.timeout(800)})).ok) return base; } catch {}
    await delay(300);
  }
  child.kill();
  throw fail(503,'本机研究引擎启动失败，请检查 Python 运行环境。');
}
process.on('exit', () => worker?.kill());
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => process.exit());
const ensure = () => ready ??= startEngine().catch(e => {ready=undefined;throw e;});

async function jsonBody(req) {
  const chunks=[]; let size=0;
  for await (const chunk of req) {
    size+=chunk.length;
    if (size>512000) throw fail(413,'请求数据过大。');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw fail(400,'请求格式错误。'); }
}
export async function assistantRequest(req, res, url) {
  const method=req.method;
  const action=url.pathname.slice('/api/vibe/research/'.length);
  const body = method==='POST' || method==='PATCH' ? await jsonBody(req) : {};
  const id = body.sessionId || url.searchParams.get('sessionId') || '';
  if (id && !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw fail(400,'研究编号无效。');
  const base=await ensure();
  const headers = {Authorization:'Bearer '+token,'Content-Type':'application/json'};
  const session='/sessions/'+encodeURIComponent(id);
  let route, payload, verb=method;
  if (action==='session' && method==='POST') {
    if (id) { route=session; verb='GET'; }
    else { route='/sessions'; payload={title:String(body.prompt || '新研究').slice(0,50)}; }
  } else if(action==='sessions' && method==='GET') route='/sessions?limit=50';
  else if(!id) throw fail(400,'缺少研究编号。');
  else if(action==='message' && method==='POST') {route=session+'/messages'; payload={content:body.prompt,require_idle:true};}
  else if(action==='messages' && method==='GET') route=session+'/messages';
  else if(action==='session' && ['PATCH','DELETE'].includes(method)){route=session;if(method==='PATCH') payload={title:body.title,pinned:body.pinned};}
  else if(action==='cancel' && method==='POST') route=session+'/cancel';
  else if(action==='events' && method==='GET') route=session+'/events?replay=active';
  else throw fail(404,'未知研究接口。');
  const events=action==='events', controller=new AbortController();
  res.once('close',()=>controller.abort());
  const lastId=req.headers['last-event-id'] || url.searchParams.get('lastEventId');
  if(events && lastId) headers['Last-Event-ID']=String(lastId);
  const response=await fetch(base+route,{method:verb,headers,body:payload && JSON.stringify(payload),signal:controller.signal});
  if(!response.ok) {
    const info=await response.json().catch(()=>({}));
    throw fail(response.status,typeof info.detail==='string' ? info.detail : '研究引擎未能完成请求。');
  }
  if(events){
    res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','X-Accel-Buffering':'no'});
    res.write('retry: 3000\n: connected\n\n');
    await pipeline(Readable.fromWeb(response.body),res);
    return;
  }
  const result=await response.json();
  res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(JSON.stringify(action==='session' && method==='POST' ? {sessionId:result.session_id} : result));
}
