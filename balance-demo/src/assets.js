// Asset metadata and model presets, copied from app/src.html so the demo stays in step with the app.
export const ASSETS = {
  QQQM: { cn: '纳斯达克 100', risk: 5, color: '#EB5934' },
  IBIT: { cn: '比特币现货', risk: 6, color: '#E79525' },
  SPY: { cn: '标普 500', risk: 4, color: '#345DE3' },
  VTI: { cn: '美国全市场', risk: 4, color: '#527EBC' },
  VXUS: { cn: '美国以外全球', risk: 4, color: '#7562D3' },
  VWO: { cn: '新兴市场', risk: 4, color: '#AB57A2' },
  SCHD: { cn: '美国红利 100', risk: 3, color: '#229584' },
  VNQ: { cn: '美国房地产信托', risk: 4, color: '#9A6854' },
  GLD: { cn: '黄金', risk: 3, color: '#D29827' },
  BND: { cn: '美国综合债', risk: 2, color: '#599CC4' },
  TLT: { cn: '20 年以上美国国债', risk: 3, color: '#3E668D' },
  SHY: { cn: '1–3 年美国国债', risk: 1, color: '#8A97B2' },
  SSE: { cn: '上证指数', risk: 4, color: '#A44E8B' },
  A500: { cn: '中证 A500', risk: 4, color: '#D65E6F' },
  BANK: { cn: '华宝银行 ETF', risk: 4, color: '#488A59' },
  SOEDIV: { cn: '央企红利 ETF', risk: 4, color: '#B46C39' },
  CHINEXT: { cn: '创业板', risk: 5, color: '#8356C2' },
  HSI: { cn: '恒生指数', risk: 4, color: '#2D8690' },
  HSTECH: { cn: '恒生科技', risk: 5, color: '#638AC7' },
};

// R4 and above go on the left pan, R1–R3 on the right
export const isHigh = id => ASSETS[id].risk >= 4;

export const PRESETS = [
  { key: 'steady', name: '稳健', w: { SPY: 20, SCHD: 10, VXUS: 5, GLD: 15, BND: 35, SHY: 15 }, abs: 5, rel: 25 },
  { key: 'balanced', name: '均衡', w: { SPY: 30, QQQM: 10, SCHD: 10, VXUS: 10, GLD: 15, BND: 22, IBIT: 3 }, abs: 5, rel: 30 },
  { key: 'cnus', name: '中美均衡', w: { SPY: 25, QQQM: 10, A500: 15, HSI: 5, SOEDIV: 5, GLD: 15, BND: 25 }, abs: 5, rel: 30 },
  { key: 'bold', name: '激进', w: { QQQM: 30, SPY: 25, VXUS: 10, SCHD: 5, VWO: 5, GLD: 10, IBIT: 10, BND: 5 }, abs: 5, rel: 30 },
  { key: 'mine', name: '我的初始想法', w: { QQQM: 25, IBIT: 10, SPY: 30, GLD: 15, SCHD: 20 }, abs: 5, rel: 30 },
];
