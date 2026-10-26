// Which Yahoo tickers make up each asset's history, oldest first.
// The last ticker is the asset itself; earlier ones fill the years before it existed and are spliced on in turn.
export const CHAINS = {
  QQQM: ['QQQ', 'QQQM'],
  IBIT: ['BTC-USD', 'IBIT'],
  SPY: ['SPY'],
  VTI: ['VTSMX', 'VTI'],
  VXUS: ['VGTSX', 'VXUS'],
  VWO: ['VEIEX', 'VWO'],
  SCHD: ['SCHD'],
  VNQ: ['VGSIX', 'VNQ'],
  GLD: ['GC=F', 'GLD'],
  BND: ['VBMFX', 'BND'],
  TLT: ['VUSTX', 'TLT'],
  SHY: ['VFISX', 'SHY'],
  // China and Hong Kong (priced in CNY / HKD)
  SSE: ['000001.SS'],                          // SSE Composite, a price index (no dividends)
  A500: ['000001.SS', '510300.SS', '512050.SS'], // CSI A500 ETF; before it, CSI 300 ETF, before that the SSE Composite
  BANK: ['512800.SS'],                          // Hwabao CSI Bank ETF, from 2017
  SOEDIV: ['510880.SS', '561580.SS'],           // CSI SOE Dividend ETF; before it, SSE Dividend ETF
  CHINEXT: ['159915.SZ'],                       // E Fund ChiNext ETF, from 2011
  HSI: ['^HSI', '2800.HK'],                     // Tracker Fund of Hong Kong; before it, the Hang Seng price index
  HSTECH: ['KWEB', '3033.HK'],                  // CSOP Hang Seng TECH ETF; before it, KWEB (China internet, USD)
};

// exchange rates used to express CNY and HKD assets in US dollars (Yahoo quotes them as local currency per USD)
export const FX = { CNY: 'CNY=X', HKD: 'HKD=X' };
// before Yahoo's FX history starts (mid-2001) both currencies were pegged
export const FX_PEG = { CNY: 8.2770, HKD: 7.7990 };

export const TICKERS = [...new Set([...Object.values(CHAINS).flat(), ...Object.values(FX)])];

// Yahoo tickers can contain "=" or "^", which are awkward in file names
export const fileFor = ticker => ticker.replace('=', '_').replace('^', '_') + '.json';

export const APP_DIR = new URL('..', import.meta.url);
export const RAW_DIR = new URL('data/raw/', APP_DIR);
export const DATA_FILE = new URL('data/prices-weekly.json', APP_DIR);
