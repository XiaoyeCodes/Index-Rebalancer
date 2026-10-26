// Tiny static server for previewing the page locally: node app/scripts/serve.mjs
import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const root = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '');
http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]) === '/' ? 'heng.html' : decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(root) || !fs.existsSync(p)) { res.writeHead(404); return res.end('not found'); }
  // the published artifact gets its viewport meta from the platform skeleton; add it here so phone widths preview correctly
  if (p.endsWith('.html')) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' + fs.readFileSync(p, 'utf8')); }
  res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
}).listen(+(process.env.PORT || 5178), () => console.log('http://localhost:5178'));
