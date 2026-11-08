// Tiny static server for previewing the page locally: node app/scripts/serve.mjs
import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const root = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '');
http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]) === '/' ? 'heng.html' : decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(root) || !fs.existsSync(p)) { res.writeHead(404); return res.end('not found'); }
  if (p.endsWith('.html')) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(p, 'utf8')); }
  res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
}).listen(+(process.env.PORT || 5178), () => console.log('http://localhost:5178'));
