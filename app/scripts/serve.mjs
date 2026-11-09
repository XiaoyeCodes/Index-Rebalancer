import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assistantRequest } from './assistant-service.mjs';

import { accountGate } from './account-gate.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.PORT || 5178);
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png'};
http.createServer(async (req,res) => {
  try {
    const host=req.headers.host;
    if (!['127.0.0.1','localhost'].some(h => host === h + ':' + port)) {res.writeHead(403); return res.end();}
    const url=new URL(req.url,'http://'+host);
    if(await accountGate(req,res,url))return;
    if(url.pathname.startsWith('/api/vibe/research/')) {
      if ((req.headers.origin && req.headers.origin !== url.origin) || req.headers['sec-fetch-site']==='cross-site') {res.writeHead(403);return res.end();}
      await assistantRequest(req,res,url);
      return;
    }
    if(!['GET','HEAD'].includes(req.method)) {res.writeHead(405);return res.end();}
    const file=path.resolve(root,'.'+(url.pathname==='/'?'/heng.html':decodeURIComponent(url.pathname)));
    const relative=path.relative(root,file);
    if(relative.startsWith('..') || path.isAbsolute(relative) || !fs.statSync(file,{throwIfNoEntry:false})?.isFile()){res.writeHead(404);return res.end();}
    res.writeHead(200,{'Content-Type':mime[path.extname(file)] || 'application/octet-stream','X-Content-Type-Options':'nosniff'});
    if(req.method==='HEAD') return res.end();
    fs.createReadStream(file).on('error',()=>res.destroy()).pipe(res);
  } catch(error) {
    if(res.destroyed || res.writableEnded) return;
    if(res.headersSent) return res.end();
    res.writeHead(error.status || 500,{'Content-Type':'application/json; charset=utf-8'});
    res.end(JSON.stringify({detail:error.status ? error.message : '本地研究服务暂时不可用。'}));
  }
}).listen(port,'127.0.0.1',()=>console.log('http://127.0.0.1:'+port));
