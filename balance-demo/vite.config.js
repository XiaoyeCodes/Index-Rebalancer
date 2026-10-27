import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The app's weekly price file is 650 KB; the demo only needs each asset's latest
// price and the price a year earlier (in USD), so we expose just that as a virtual module.
const DATA = fileURLToPath(new URL('../app/data/prices-weekly.json', import.meta.url));
const ID = 'virtual:prices';

function prices() {
  return {
    name: 'heng-prices',
    resolveId: s => (s === ID ? '\0' + ID : null),
    load(s) {
      if (s !== '\0' + ID) return null;
      this.addWatchFile(DATA);
      const d = JSON.parse(readFileSync(DATA, 'utf8'));
      const usd = (a, back) => {
        const fx = a.currency && a.currency !== 'USD' ? d.fx[a.currency].at(-back) : 1;
        return +(a.c.at(-back) / fx).toFixed(4);
      };
      const assets = Object.fromEntries(Object.entries(d.assets).map(([id, a]) => [id, { now: usd(a, 1), ago: usd(a, 53) }]));
      return `export default ${JSON.stringify({ asOf: d.asOf, assets })};`;
    },
  };
}

export default defineConfig({ plugins: [prices()], server: { port: 5179 } });
