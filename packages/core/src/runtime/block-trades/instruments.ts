export function extractUnderlying(instrument: string): string {
  return instrument.split('-')[0]!.replace(/_.*$/, '').toUpperCase();
}

export function isOptionInstrument(instrument: string): boolean {
  const parts = instrument.split('-');
  // Bybit appended a currency suffix in 2026: BTC-28MAR26-60000-C-USDT.
  // Find C/P from the end so both old and new formats work.
  let typeIdx = -1;
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i] === 'C' || parts[i] === 'P') {
      typeIdx = i;
      break;
    }
  }
  if (typeIdx < 0) return false;
  const strike = parts[typeIdx - 1];
  const expiry = parts[typeIdx - 2];
  const hasStrike = strike != null && /^[0-9]+(?:\.[0-9]+)?$/.test(strike);
  const hasExpiry =
    expiry != null && (/^\d{1,2}[A-Z]{3}\d{2}$/.test(expiry) || /^\d{6,8}$/.test(expiry));
  return hasStrike && hasExpiry;
}

export function areOptionLegs(instruments: string[]): boolean {
  return (
    instruments.length > 0 && instruments.every((instrument) => isOptionInstrument(instrument))
  );
}

const DERIBIT_COMBO_STRATEGIES: Record<string, string> = {
  STRD: 'STRADDLE',
  STRG: 'STRANGLE',
  CS: 'CALL_SPREAD',
  PS: 'PUT_SPREAD',
  CF: 'CALL_BUTTERFLY',
  PF: 'PUT_BUTTERFLY',
  CBUT: 'CALL_BUTTERFLY',
  PBUT: 'PUT_BUTTERFLY',
  IC: 'IRON_CONDOR',
  ICOND: 'IRON_CONDOR',
  IB: 'IRON_BUTTERFLY',
  IBUT: 'IRON_BUTTERFLY',
  CR: 'CALL_RATIO',
  PR: 'PUT_RATIO',
  CCS: 'CALL_CALENDAR_SPREAD',
  PCS: 'PUT_CALENDAR_SPREAD',
  CCAL: 'CALL_CALENDAR_SPREAD',
  PCAL: 'PUT_CALENDAR_SPREAD',
  CD: 'CALL_DIAGONAL',
  PD: 'PUT_DIAGONAL',
  CDIAG: 'CALL_DIAGONAL',
  PDIAG: 'PUT_DIAGONAL',
  RR: 'RISK_REVERSAL',
  FSR: 'FUTURE_SPREAD',
  COMBO: 'COMBO',
};

// Deribit combo_id encodes strategy: BTC-STRD-27MAR26-70000, BTC-PCAL-30OCT26_23OCT26-76000, etc.
export function deriveStrategy(comboId: string | null | undefined, legCount: number): string | null {
  if (!comboId) return legCount > 1 ? 'CUSTOM' : null;
  const code = comboId.split('-')[1]?.toUpperCase();
  return DERIBIT_COMBO_STRATEGIES[code ?? ''] ?? (legCount > 1 ? 'CUSTOM' : null);
}
