export interface SectorMemberDef {
  /** Options underlying / display symbol. */
  symbol: string;
  label?: string;
  /** Bybit linear perp; defaults to `${symbol}USDT`. */
  bybit?: string;
  /** Units per contract quote, e.g. 1000 for 1000PEPEUSDT; the price is divided back to one coin. */
  scale?: number;
  /** Bybit stock/ETF perps trade thinly outside NYSE hours; correlation only counts in-session bars. */
  session?: 'always' | 'us-equity';
}

export interface SectorBasketDef {
  id: string;
  name: string;
  members: readonly (string | SectorMemberDef)[];
}

const thousand = (symbol: string, bybit = `1000${symbol}USDT`): SectorMemberDef => ({
  symbol,
  bybit,
  scale: 1000,
});

// US100/US500 options settle on the index; Bybit has no index perp, so QQQ/SPY stand in.
const US100: SectorMemberDef = {
  symbol: 'US100',
  label: 'US100 (QQQ)',
  bybit: 'QQQUSDT',
  session: 'us-equity',
};
const US500: SectorMemberDef = {
  symbol: 'US500',
  label: 'US500 (SPY)',
  bybit: 'SPYUSDT',
  session: 'us-equity',
};
const stock = (symbol: string): SectorMemberDef => ({ symbol, session: 'us-equity' });

export const SECTOR_TAPE: readonly (string | SectorMemberDef)[] = [
  'BTC',
  'ETH',
  'SOL',
  'HYPE',
  'XRP',
  US500,
  US100,
  { symbol: 'XAU', label: 'GOLD' },
  { symbol: 'CL', label: 'WTI' },
];

export const SECTOR_BASKETS: readonly SectorBasketDef[] = [
  { id: 'majors', name: 'Majors', members: ['BTC', 'ETH', 'SOL', 'XRP', 'BNB'] },
  {
    id: 'old-guard',
    name: 'Old Guard',
    members: ['LTC', 'ADA', 'TRX', 'BCH', 'XLM', 'ETC', 'HBAR'],
  },
  {
    id: 'alt-l1',
    name: 'Alt L1',
    members: ['AVAX', 'SUI', 'NEAR', 'APT', 'SEI', 'TIA', 'DOT', 'ATOM'],
  },
  {
    id: 'perp-dex',
    name: 'Perp DEX / Exchange',
    members: ['HYPE', 'LIT', 'ASTER', 'DYDX', 'GMX', 'JUP', 'CAKE'],
  },
  {
    id: 'defi',
    name: 'DeFi',
    members: ['AAVE', 'ENA', 'PENDLE', 'UNI', 'CRV', 'LDO', 'ONDO', 'ETHFI', 'MORPHO'],
  },
  {
    id: 'memes',
    name: 'Memes / Political',
    members: [
      'DOGE',
      'TRUMP',
      'WLFI',
      thousand('SHIB', 'SHIB1000USDT'),
      thousand('PEPE'),
      thousand('BONK'),
      'WIF',
      thousand('FLOKI'),
      'PENGU',
      'FARTCOIN',
    ],
  },
  { id: 'btc-eco', name: 'BTC Eco / PoW', members: ['ORDI', 'KAS', 'STX', 'BABY'] },
  { id: 'privacy', name: 'Privacy', members: ['ZEC', 'XMR', 'DASH'] },
  { id: 'ai', name: 'AI', members: ['TAO', 'RENDER', 'VIRTUAL', 'WLD', 'IO', 'GRASS', 'AIXBT'] },
  { id: 'l2', name: 'L2', members: ['ARB', 'OP', 'POL', 'STRK', 'ZK', 'MNT', 'IMX'] },
  {
    id: 'rwa',
    name: 'RWA',
    members: [
      { symbol: 'XAU', label: 'XAU (gold)' },
      { symbol: 'XAG', label: 'XAG (silver)' },
      { symbol: 'CL', label: 'CL (WTI)' },
      'XAUT',
      'PAXG',
      US500,
      US100,
      stock('META'),
      stock('MSTR'),
      stock('MU'),
      stock('SPCX'),
    ],
  },
];

export function memberDef(member: string | SectorMemberDef): Required<SectorMemberDef> {
  const def = typeof member === 'string' ? { symbol: member } : member;
  return {
    symbol: def.symbol,
    label: def.label ?? def.symbol,
    bybit: def.bybit ?? `${def.symbol}USDT`,
    scale: def.scale ?? 1,
    session: def.session ?? 'always',
  };
}
