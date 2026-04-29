// DXLink connection lifecycle + market-hours awareness.
// US listed-options sessions: RTH 09:30–16:00 ET. SPX/NDX have extended hours.

export type TastytradeHealthSignal = 'live' | 'reconnecting' | 'session-expired' | 'market-closed' | 'down';

export interface TastytradeHealthState {
  signal: TastytradeHealthSignal;
  lastFrameAt: number | null;
  /** When the current quote token expires (ms). Refresh proactively. */
  quoteTokenExpiresAt: number | null;
}

export function createTastytradeHealthState(): TastytradeHealthState {
  return {
    signal: 'down',
    lastFrameAt: null,
    quoteTokenExpiresAt: null,
  };
}

/** Simple US equity-market-hours check. Index options (SPX/NDX) override via product config. */
export function isUsEquityMarketOpen(_nowMs: number): boolean {
  // 09:30–16:00 America/New_York, Mon–Fri, exchange holidays excluded.
  throw new Error('isUsEquityMarketOpen not implemented');
}
