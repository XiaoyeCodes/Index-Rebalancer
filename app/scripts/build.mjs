// Inlines the weekly price data into the page: node app/scripts/build.mjs
import fs from 'fs';
const dir = new URL('..', import.meta.url);
const src = fs.readFileSync(new URL('src.html', dir), 'utf8');
const data = fs.readFileSync(new URL('data/prices-weekly.json', dir), 'utf8');
fs.writeFileSync(new URL('heng.html', dir), src.replace('__DATA__', () => data));
console.log('built heng.html', (src.length + data.length) / 1024 | 0, 'KB');
