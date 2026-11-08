// Prepare only the public application for static hosting; do not publish source or product docs.
// Run after build.mjs: node app/scripts/publish.mjs
import fs from 'node:fs';

const app = new URL('../', import.meta.url);
const output = new URL('../../dist/', import.meta.url);
const html = fs.readFileSync(new URL('heng.html', app), 'utf8');
if (!html.startsWith('<!doctype html>') || html.includes('__DATA__')) {
  throw new Error('Run node app/scripts/build.mjs before preparing the website.');
}
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(new URL('index.html', output), html);
fs.writeFileSync(new URL('.nojekyll', output), '');
console.log('Website ready: dist/index.html');
