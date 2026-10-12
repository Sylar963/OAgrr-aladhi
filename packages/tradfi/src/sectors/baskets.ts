export interface SectorBasketDef {
  id: string;
  name: string;
  symbols: readonly string[];
}

export interface TapeDef {
  symbol: string;
  label: string;
}

// Futures and spot crypto aren't on the equity-options feed, so the tape uses
// index and ETF proxies (DIA≈YM, IWM≈RTY, IBIT≈BTC, GLD/SLV/CPER/BNO≈metals+Brent).
export const SECTOR_TAPE: readonly TapeDef[] = [
  { symbol: 'SPX', label: 'SPX' },
  { symbol: 'NDX', label: 'NDX' },
  { symbol: 'DIA', label: 'DIA' },
  { symbol: 'IWM', label: 'IWM' },
  { symbol: 'VIX', label: 'VIX' },
  { symbol: 'SOXX', label: 'SOXX' },
  { symbol: 'IGV', label: 'IGV' },
  { symbol: 'TLT', label: 'TLT' },
  { symbol: 'IBIT', label: 'BTC (IBIT)' },
  { symbol: 'GLD', label: 'Gold (GLD)' },
  { symbol: 'SLV', label: 'Silver (SLV)' },
  { symbol: 'CPER', label: 'Copper (CPER)' },
  { symbol: 'BNO', label: 'Brent (BNO)' },
];

export const SECTOR_BASKETS: readonly SectorBasketDef[] = [
  { id: 'oil-gas', name: 'Oil/Gas', symbols: ['XOM', 'CVX', 'COP', 'FANG', 'EOG', 'OXY', 'DVN', 'HAL', 'SLB', 'MPC'] },
  { id: 'insurance', name: 'Insurance', symbols: ['ALL', 'MET', 'AIG', 'PRU', 'PGR', 'TRV', 'CB', 'AFL', 'HIG', 'CINF'] },
  { id: 'mag7', name: 'Mag 7', symbols: ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA', 'TSLA'] },
  { id: 'banks', name: 'Banks', symbols: ['JPM', 'BAC', 'WFC', 'C', 'GS', 'MS', 'USB', 'TFC', 'PNC'] },
  { id: 'cons-def', name: 'Cons Def', symbols: ['KO', 'PG', 'PEP', 'HSY', 'MO', 'PM', 'CL', 'MDLZ', 'WMT', 'COST'] },
  { id: 'health', name: 'Health', symbols: ['LLY', 'UNH', 'JNJ', 'ABBV', 'ABT', 'MRK', 'PFE', 'TMO', 'HUM', 'DXCM'] },
  { id: 'cons-disc', name: 'Cons Disc', symbols: ['HD', 'LOW', 'NKE', 'MCD', 'SBUX', 'CMG', 'BKNG', 'ABNB', 'CCL', 'RCL'] },
  { id: 'aero-def', name: 'Aero/Def', symbols: ['LMT', 'GD', 'NOC', 'RTX', 'LHX', 'BA', 'KTOS', 'AVAV'] },
  { id: 'ship-log', name: 'Ship/Log', symbols: ['UNP', 'CSX', 'NSC', 'FDX', 'UPS', 'MATX', 'CHRW', 'XPO', 'GXO', 'ZIM'] },
  { id: 'chem', name: 'Chem', symbols: ['LIN', 'APD', 'ECL', 'SHW', 'DOW', 'LYB', 'DD', 'ALB', 'CF', 'MOS'] },
  { id: 'macro', name: 'Macro', symbols: ['USO', 'UNG', 'UUP', 'GLD', 'SLV', 'TLT', 'HYG', 'VIXY', 'IBIT'] },
  { id: 'biotech', name: 'Biotech', symbols: ['AMGN', 'GILD', 'VRTX', 'REGN', 'BIIB', 'MRNA', 'ALNY', 'SRPT', 'XBI'] },
  { id: 'fintech', name: 'Fintech', symbols: ['FISV', 'PYPL', 'XYZ', 'COIN', 'HOOD', 'AFRM', 'SOFI', 'UPST', 'TOST', 'FOUR'] },
  { id: 'builders', name: 'Builders', symbols: ['DHI', 'LEN', 'PHM', 'TOL', 'KBH', 'NVR', 'GRBK', 'MAS', 'BLDR'] },
  { id: 'agentic', name: 'Agentic', symbols: ['PLTR', 'NOW', 'CRM', 'META', 'MSFT', 'CRWD', 'AKAM', 'NET', 'DDOG', 'SNOW', 'AI', 'PATH'] },
  { id: 'solar', name: 'Solar', symbols: ['FSLR', 'ENPH', 'SEDG', 'RUN', 'ARRY', 'NXT', 'CSIQ', 'SHLS', 'TAN'] },
  { id: 'cloud', name: 'Cloud', symbols: ['ORCL', 'CRM', 'NOW', 'WDAY', 'SNOW', 'DDOG', 'MDB', 'NET', 'ADBE', 'TEAM', 'HUBS', 'TWLO'] },
  { id: 'china', name: 'China', symbols: ['BABA', 'PDD', 'JD', 'BIDU', 'NTES', 'LI', 'NIO', 'XPEV', 'BILI', 'TCOM', 'FXI', 'KWEB'] },
  { id: 'power', name: 'Power', symbols: ['VST', 'CEG', 'TLN', 'GEV', 'NRG', 'ETN', 'PWR', 'BE', 'FLNC'] },
  { id: 'btc-miners', name: 'BTC Miners', symbols: ['MARA', 'RIOT', 'CLSK', 'CORZ', 'HUT', 'CIFR', 'WULF', 'BTDR'] },
  { id: 'semi-arch', name: 'Semi Arch', symbols: ['ARM', 'CDNS', 'SNPS', 'ADI', 'TXN', 'QCOM', 'NXPI', 'MCHP', 'ON', 'INTC'] },
  { id: 'space', name: 'Space', symbols: ['RKLB', 'ASTS', 'SPCX', 'LUNR', 'RDW', 'PL', 'VSAT', 'IRDM', 'SPCE'] },
  { id: 'cyber', name: 'Cyber', symbols: ['PANW', 'CRWD', 'FTNT', 'ZS', 'NET', 'OKTA', 'S', 'CYBR', 'TENB', 'VRNS', 'QLYS', 'RPD'] },
  { id: 'robotics', name: 'Robotics', symbols: ['ISRG', 'ROK', 'EMR', 'TER', 'SYM', 'NDSN', 'ZBRA', 'OUST', 'SERV', 'RR'] },
  { id: 'neocloud', name: 'Neocloud', symbols: ['CRWV', 'NBIS', 'IREN', 'APLD', 'CIFR', 'WULF', 'HUT', 'SMCI'] },
  { id: 'rack', name: 'Rack', symbols: ['VRT', 'AVGO', 'ANET', 'DELL', 'HPE', 'SMCI', 'CLS', 'JBL', 'CRDO'] },
  { id: 'nuclear', name: 'Nuclear', symbols: ['CCJ', 'BWXT', 'OKLO', 'SMR', 'NNE', 'LEU', 'UEC', 'URA'] },
  { id: 'rare-earth', name: 'Rare Earth', symbols: ['MP', 'USAR', 'NB', 'IPX', 'UUUU', 'CRML', 'REMX'] },
  { id: 'memory', name: 'Memory', symbols: ['MU', 'WDC', 'SNDK', 'STX', 'NTAP', 'PSTG', 'SIMO', 'MRAM'] },
  { id: 'quantum', name: 'Quantum', symbols: ['IONQ', 'RGTI', 'QBTS', 'QUBT', 'ARQQ', 'LAES', 'QTUM'] },
  { id: 'optical', name: 'Optical', symbols: ['LITE', 'COHR', 'CIEN', 'AAOI', 'FN', 'GLW', 'ERIC', 'NOK', 'POET'] },
];

/** Every symbol the board needs a live quote for. */
export function sectorSymbols(): string[] {
  const set = new Set<string>(SECTOR_TAPE.map((t) => t.symbol));
  for (const b of SECTOR_BASKETS) for (const s of b.symbols) set.add(s);
  return [...set];
}
