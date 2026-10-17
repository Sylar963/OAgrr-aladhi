// ── Number formatters ─────────────────────────────────────────────────────
// Convention: null or zero prices render as "–" (industry standard — IB, TradingView).
// A zero bid/ask means "no market", not "free". Greeks CAN be legitimately zero
// (delta=0 for deep OTM) so they use separate formatters that preserve zero.

export function fmtUsd(v: number | null | undefined): string {
  if (v == null || v === 0) return '–';
  const sign = v < 0 ? '-' : '';
  const abs = Math.abs(v);
  if (abs >= 100) return `${sign}$${abs.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  if (abs >= 1) return `${sign}$${abs.toFixed(2)}`;
  if (abs >= 0.01) return `${sign}$${abs.toFixed(4)}`;
  return `${sign}$${abs.toFixed(6)}`;
}

function compactNum(v: number): string {
  if (Math.abs(v) >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toFixed(0);
}

// Underlyings span $81k (BTC) to $0.08 (DOGE): fixed decimals print DOGE spot and strikes as
// "$0". Prices keep at least 4 significant digits below $1,000 and drop cents above it.
function priceDecimals(abs: number): number {
  if (abs >= 1_000 || abs === 0) return 0;
  return Math.min(10, Math.max(2, 3 - Math.floor(Math.log10(abs))));
}

/** An underlying price or level (spot, breakeven, target) without a currency sign. */
export function fmtPrice(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '–';
  return v.toLocaleString('en-US', { maximumFractionDigits: priceDecimals(Math.abs(v)) });
}

export function fmtUsdPrice(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '–';
  return `${v < 0 ? '-' : ''}$${fmtPrice(Math.abs(v))}`;
}

/** Strikes are listed values, so they print exactly (0.0725, 1.175, 80,250), never rounded. */
export function fmtStrike(v: number): string {
  return Number(v.toPrecision(12)).toLocaleString('en-US', { maximumFractionDigits: 10 });
}

/** Card-sized strike: thousands as "80k"/"80.5k", everything below printed exactly. */
export function fmtStrikeShort(v: number): string {
  if (v >= 1_000) return `${(v / 1_000).toFixed(v % 1_000 === 0 ? 0 : 1)}k`;
  return fmtStrike(v);
}

export function fmtUsdCompact(v: number | null | undefined): string {
  if (v == null) return '–';
  const abs = Math.abs(v);
  if (abs >= 1_000 || abs === 0) return `$${compactNum(v)}`;
  if (abs >= 100) return `${v < 0 ? '-' : ''}$${abs.toFixed(0)}`;
  return fmtUsdPrice(v);
}

export function fmtIv(v: number | null | undefined): string {
  if (v == null || v === 0) return '–';
  return `${(v * 100).toFixed(1)}%`;
}

export function fmtPct(v: number | null | undefined, decimals = 2): string {
  if (v == null) return '–';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(decimals)}%`;
}

export function fmtDelta(v: number | null | undefined): string {
  if (v == null) return '–';
  return v.toFixed(3);
}

export function fmtNum(v: number | null | undefined, decimals = 2): string {
  if (v == null) return '–';
  return v.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function fmtCompact(v: number | null | undefined): string {
  if (v == null) return '–';
  return compactNum(v);
}

export function dteDays(expiry: string, expiryTs?: number | null): number {
  const now = Date.now();
  const exp = expiryTs ?? new Date(expiry + 'T08:00:00Z').getTime();
  return Math.max(0, Math.ceil((exp - now) / 86_400_000));
}

export interface TimeToExpiry {
  totalMs: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  expired: boolean;
}

export function timeToExpiry(expiry: string, expiryTs?: number | null): TimeToExpiry {
  const target = expiryTs ?? new Date(expiry + 'T08:00:00Z').getTime();
  const totalMs = Math.max(0, target - Date.now());
  const totalSec = Math.floor(totalMs / 1000);
  return {
    totalMs,
    days: Math.floor(totalSec / 86_400),
    hours: Math.floor((totalSec % 86_400) / 3600),
    minutes: Math.floor((totalSec % 3600) / 60),
    seconds: totalSec % 60,
    expired: totalMs === 0,
  };
}

export function formatExpiry(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  const day = d.getUTCDate().toString().padStart(2, '0');
  const months = [
    'JAN',
    'FEB',
    'MAR',
    'APR',
    'MAY',
    'JUN',
    'JUL',
    'AUG',
    'SEP',
    'OCT',
    'NOV',
    'DEC',
  ];
  return `${day} ${months[d.getUTCMonth()]!}`;
}
