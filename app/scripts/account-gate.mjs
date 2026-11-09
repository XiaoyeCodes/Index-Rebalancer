import {modelSettings,authenticated,login,logout,updateModel} from './vault.mjs';
import fs from 'node:fs/promises';

const pagesOrigin='https://xiaoyecodes.github.io';
const fail=(status,message)=>Object.assign(new Error(message),{status});
const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
async function body(req,max=300000){
  if(!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || ''))throw fail(415,'需要 JSON 请求。');
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>max)throw fail(413,'请求过大。');chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw fail(400,'无效的请求。');}
}
export async function accountGate(req,res,url,root){
  const origin=req.headers.origin, pages=origin===pagesOrigin;
  if(origin && !pages && origin!==url.origin)throw fail(403,'不允许此来源。');
  if(req.headers['sec-fetch-site']==='cross-site' && !pages)throw fail(403,'不允许跨站请求。');
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Vary','Origin');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(pages){
    res.setHeader('Access-Control-Allow-Origin',pagesOrigin);
    res.setHeader('Access-Control-Allow-Methods','GET, POST, PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Private-Network','true');
  }
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return true;}
  const route=url.pathname,verb=req.method;
  if((route==='/' || route==='/index.html' || route==='/heng.html') && verb==='GET'){
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end(await fs.readFile(new URL('../login.html',import.meta.url)));return true;
  }
  // These fingerprinted UI modules contain no records or credentials.
  if(/^\/assets\/assistant\/(?:index\.html|assets\/[\w.-]+\.(?:js|css|woff2))$/.test(route) && verb==='GET')return false;
  const audience=pages?pagesOrigin:url.origin;
  const token=pages ? (req.headers.authorization || '').replace(/^Bearer /,'') :
    /(?:^|;\s*)heng_session=([A-Za-z0-9_-]+)/.exec(req.headers.cookie || '')?.[1];
  if(route==='/api/account/login' && verb==='POST'){
    const {password}=await body(req,4096);
    const session=await login(password,audience);
    if(!pages)res.setHeader('Set-Cookie','heng_session='+session+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800');
    send(res,200,pages?{token:session}:{ok:true});return true;
  }
  if(!authenticated(token,audience))throw fail(401,'请先输入密码登录。');
  if(route==='/api/account/logout' && verb==='POST'){
    await body(req,4096);logout(token);
    if(!pages)res.setHeader('Set-Cookie','heng_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    send(res,200,{ok:true});return true;
  }
  if(route==='/api/account/status' && verb==='GET'){send(res,200,{ok:true});return true;}
  if(route==='/api/account/app' && verb==='GET'){
    res.setHeader('Content-Type','text/html; charset=utf-8');res.end(await fs.readFile(new URL('../heng.html',import.meta.url)));return true;
  }
  if(route==='/api/account/settings' && ['GET','PUT'].includes(verb)){
    if(verb==='PUT'){
      if(pages)throw fail(403,'请在本机页面修改 AI 配置。');
      const draft=await body(req,8192);updateModel(draft);
    }
    const {model,baseUrl}=modelSettings();send(res,200,{model,baseUrl});return true;
  }
  if(route==='/api/account/chat' && verb==='POST'){
    const {prompt}=await body(req);
    if(typeof prompt!=='string'||!prompt.trim()||prompt.length>200000)throw fail(400,'研究问题为空或超出长度限制。');
    const {key,model,baseUrl}=modelSettings();
    const controller=new AbortController();res.once('close',()=>controller.abort());
    const upstream=await fetch(baseUrl.replace(/\/+$/,'')+'/chat/completions',{method:'POST',redirect:'error',
      headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},signal:AbortSignal.any([controller.signal,AbortSignal.timeout(120000)]),
      body:JSON.stringify({model,messages:[{role:'user',content:prompt}],stream:false})});
    if(!upstream.ok)throw fail(upstream.status===429?429:502,'模型服务调用失败（'+upstream.status+'）。');
    const data=await upstream.json();const text=data.choices?.[0]?.message?.content;
    if(typeof text!=='string' || !text.trim())throw fail(502,'模型返回了空结果。');
    send(res,200,{text,usage:data.usage});return true;
  }
  if(!route.startsWith('/api/vibe/research/'))throw fail(404,'未找到资源。');
  return false;
}
