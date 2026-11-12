import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { randomBytes, createCipheriv, publicEncrypt } from 'node:crypto';

const root = fileURLToPath(new URL('../../', import.meta.url));
const app = path.join(root, 'app');
const output = path.join(root, 'dist');
const allowed = new Set(['index.html', '.nojekyll', 'pages-login.js', 'workspace-sync.js', 'browser-model.js', 'browser-session.js', 'application.bin', 'assets']);
fs.mkdirSync(output, {recursive:true});
for (const entry of fs.readdirSync(output, {withFileTypes:true})) {
  if (!allowed.has(entry.name) || (entry.name==='assets' ? !entry.isDirectory() : !entry.isFile())) {
    throw Error('Unexpected file in dist/. Use a clean output directory.');
  }
}
const assistant = path.join(root, 'assistant');
fs.mkdirSync(path.join(output,'assets'),{recursive:true});
fs.copyFileSync(path.join(app,'assets/favicon.png'),path.join(output,'assets/favicon.png'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const options = {cwd:assistant,stdio:'inherit',shell:process.platform==='win32'};
if (!fs.existsSync(path.join(assistant,'node_modules/vite/bin/vite.js'))) execFileSync(npm,['ci'],options);
execFileSync(process.execPath, ['node_modules/vite/bin/vite.js','build','--outDir',path.join(output,'assets/assistant'),'--emptyOutDir'], {cwd:assistant,stdio:'inherit'});

// Keep third-party code on the Pages origin while visitors use their own credentials.
const vendor = path.join(output,'assets/vendor');
const packages = path.join(assistant,'node_modules');
const vendorFiles = {
  'three/build/three.module.min.js': 'three.module.js',
  'three/examples/jsm/controls/OrbitControls.js': 'controls/OrbitControls.js',
  'three/examples/jsm/environments/RoomEnvironment.js': 'environments/RoomEnvironment.js',
  'three/LICENSE': 'three-LICENSE.txt',
  'lightweight-charts/dist/lightweight-charts.standalone.production.js': 'charts.js',
  'lightweight-charts/LICENSE': 'charts-LICENSE.txt'
};
for (const [source,destination] of Object.entries(vendorFiles)) {
  const target = path.join(vendor,destination);
  fs.mkdirSync(path.dirname(target),{recursive:true});
  fs.copyFileSync(path.join(packages,source),target);
}
const page = fs.readFileSync(path.join(app,'heng.html'),'utf8')
  .replace('https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js','./assets/vendor/three.module.js')
  .replace('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/','./assets/vendor/')
  .replace('https://cdn.jsdelivr.net/npm/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js','./assets/vendor/charts.js');

const {publicKey, ...access} = JSON.parse(fs.readFileSync(path.join(app,'pages-access.json'),'utf8'));
const key = randomBytes(32), iv = randomBytes(12);
const cipher = createCipheriv('aes-256-gcm', key, iv);
const encrypted = Buffer.concat([cipher.update(page,'utf8'),cipher.final(),cipher.getAuthTag()]);
const wrapped = publicEncrypt({key:publicKey,oaepHash:'sha256'},key);
fs.writeFileSync(path.join(output,'application.bin'),encrypted);
const {endpoint} = JSON.parse(fs.readFileSync(path.join(app,'sync-deployment.json'),'utf8'));
if (endpoint && new URL(endpoint).protocol!=='https:') throw Error('Shared workspace requires HTTPS.');
const envelope = {...access, syncEndpoint:endpoint, wrapped:wrapped.toString('base64'), appIv:iv.toString('base64')};
const shell = fs.readFileSync(path.join(app,'login.html'),'utf8').split('<!-- login runtime -->')[0];
fs.writeFileSync(path.join(output,'index.html'),shell+'<script id="access" type="application/json">'+JSON.stringify(envelope)+'</script><script type="module" src="./pages-login.js"></script></body></html>');
for (const name of ['pages-login.js','workspace-sync.js','browser-model.js','browser-session.js']) fs.copyFileSync(path.join(app,name),path.join(output,name));
fs.writeFileSync(path.join(output,'.nojekyll'),'');
