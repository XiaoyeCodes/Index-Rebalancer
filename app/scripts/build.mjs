// Produce the self-contained page used by both the local preview and GitHub Pages.
import fs from 'node:fs';
import {createHash} from 'node:crypto';

const app = new URL('../', import.meta.url);
const read = name => fs.readFileSync(new URL(name, app), 'utf8').replace(/\r\n/g,'\n');
function embeddedAsset(name, type) {
  let bytes = fs.readFileSync(new URL('assets/' + name, app));
  if(type==='image/svg+xml') bytes=Buffer.from(bytes.toString('utf8').replace(/\r\n/g,'\n'));
  return 'data:' + type + ';base64,' + bytes.toString('base64');
}

const css = read('ui.css').replace(/url\("assets\/(dm-(?:regular|medium)\.woff2)"\)/g,
  (_, font) => 'url("' + embeddedAsset(font, 'font/woff2') + '")');
const fontLicense = read('assets/FONT-LICENSE.txt');
const page = read('src.html')
  .replace('<link rel="stylesheet" href="ui.css">', () => '<style>\n/* ' + fontLicense + ' */\n' + css + '\n' + '\n</style>')
  .replace(/(["'])assets\/([^"']+\.(png|webp|svg))\1/g,
    (_, quote, name, extension) => quote + embeddedAsset(name, 'image/' + (extension === 'svg' ? 'svg+xml' : extension)) + quote)
  .replace('__DATA__', () => JSON.stringify({...JSON.parse(read('data/prices-weekly.json')),fundFacts:JSON.parse(read('data/fund-facts.json'))}))
  .replace('__DATA_SHA__', () => createHash('sha256').update(read('data/prices-weekly.json')).digest('hex'))
  .replace('<script src="market-calendar.js"></script>', () => '<script>\n' + read('market-calendar.js') + '\n</script>')
  .replace('<script src="investment.js"></script>', () => '<script>\n' + read('investment.js') + '\n</script>')
  .replace('<script src="investment-book.js"></script>', () => '<script>\n' + read('investment-book.js').replace('export const InvestmentData','const InvestmentData') + '\n</script>')
  .replace('<script src="investment-data-ui.js"></script>', () => '<script>\n' + read('investment-data-ui.js') + '\n</script>')
  .replace('<script src="ledger.js"></script>', () => '<script>\n' + read('ledger.js') + '\n</script>')
  .replace('<script src="ledger-ui.js"></script>', () => '<script>\n' + read('ledger-ui.js') + '\n</script>')
  .replace('<script src="ai.js"></script>', () => '<script>\n' + read('ai.js') + '\n</script>');
fs.writeFileSync(new URL('heng.html', app), page);
console.log('built heng.html', Math.round(Buffer.byteLength(page) / 1024), 'KB');
