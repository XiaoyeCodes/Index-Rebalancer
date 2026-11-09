// The Pages artifact may contain only the login shell.
import fs from 'node:fs';

const output = new URL('../../dist/', import.meta.url);
fs.mkdirSync(output, { recursive: true });
const allowed = new Set(['index.html', '.nojekyll']);
for (const entry of fs.readdirSync(output, { withFileTypes: true })) {
  if (!entry.isFile() || !allowed.has(entry.name)) {
    throw new Error('Unexpected file in dist/. Use a clean output directory before publishing.');
  }
}
fs.copyFileSync(new URL('../login.html', import.meta.url), new URL('index.html', output));
fs.writeFileSync(new URL('.nojekyll', output), '');
console.log('Pages login ready in dist/');
