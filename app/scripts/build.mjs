// Produce the self-contained page used by both the local preview and GitHub Pages.
import fs from 'node:fs';

const app = new URL('../', import.meta.url);
const read = name => fs.readFileSync(new URL(name, app), 'utf8');
function embeddedAsset(name, type) {
  const bytes = fs.readFileSync(new URL('assets/' + name, app));
  return 'data:' + type + ';base64,' + bytes.toString('base64');
}

const css = read('ui.css').replace(/url\("assets\/(dm-(?:regular|medium)\.woff2)"\)/g,
  (_, font) => 'url("' + embeddedAsset(font, 'font/woff2') + '")');
const fontLicense = read('assets/FONT-LICENSE.txt');
const page = read('src.html')
  .replace('<link rel="stylesheet" href="ui.css">', () => '<style>\n/* ' + fontLicense + ' */\n' + css + '\n' + '\n</style>')
  .replace(/(["'])assets\/([^"']+\.(png|webp|svg))\1/g,
    (_, quote, name, extension) => quote + embeddedAsset(name, 'image/' + (extension === 'svg' ? 'svg+xml' : extension)) + quote)
  .replace('__DATA__', () => read('data/prices-weekly.json'))
  .replace('<script src="ai.js"></script>', () => '<script>\n' + read('ai.js') + '\n</script>');
fs.writeFileSync(new URL('heng.html', app), page);
console.log('built heng.html', Math.round(Buffer.byteLength(page) / 1024), 'KB');
