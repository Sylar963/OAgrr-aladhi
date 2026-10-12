import type { EquityHistoryPoint, PositionLeg } from '@oggregator/protocol';

import { naturalKeyOf } from '../../portfolio/position-fold.js';
import {
  ParadexJwtClaimsSchema,
  type ParadexAccountHistory,
  type ParadexJwtClaims,
  type ParadexPosition,
} from './types.js';

const MONTHS: Record<string, string> = {
  JAN: '01',
  FEB: '02',
  MAR: '03',
  APR: '04',
  MAY: '05',
  JUN: '06',
  JUL: '07',
  AUG: '08',
  SEP: '09',
  OCT: '10',
  NOV: '11',
  DEC: '12',
};

// Option markets are BASE-QUOTE-DDMONYY-STRIKE-C|P; decimal strikes use `_` (167_5 = 167.5).
export function parseParadexOptionSymbol(symbol: string): {
  underlying: string;
  expiry: string;
  strike: number;
  optionRight: 'call' | 'put';
} | null {
  const parts = symbol.split('-');
  if (parts.length !== 5) return null;
  const [underlying, , dateRaw, strikeRaw, rightRaw] = parts;
  if (!underlying || !dateRaw || !strikeRaw || !rightRaw) return null;
  const date = /^(\d{1,2})([A-Z]{3})(\d{2})$/.exec(dateRaw);
  const month = date == null ? undefined : MONTHS[date[2]!];
  if (date == null || month == null) return null;
  const strike = Number(strikeRaw.replace('_', '.'));
  if (!Number.isFinite(strike) || strike <= 0) return null;
  const optionRight = rightRaw === 'C' ? 'call' : rightRaw === 'P' ? 'put' : null;
  if (optionRight == null) return null;
  return {
    underlying,
    expiry: `20${date[3]}-${month}-${date[1]!.padStart(2, '0')}`,
    strike,
    optionRight,
  };
}

function finiteOrNull(raw: string | undefined): number | null {
  if (raw == null || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function paradexPositionToLeg(
  pos: ParadexPosition,
  nowMs: number = Date.now(),
): PositionLeg | null {
  if (pos.status !== 'OPEN') return null;
  const parsed = parseParadexOptionSymbol(pos.market);
  if (parsed == null) return null;
  const size = finiteOrNull(pos.size);
  if (size == null || size === 0) return null;
  const entryPriceUsd = finiteOrNull(pos.average_entry_price_usd ?? pos.average_entry_price);
  if (entryPriceUsd == null || entryPriceUsd <= 0) return null;

  // Positions carry no mark; back it out of the venue's own unrealized P&L so the
  // portfolio total matches what Paradex shows.
  const unrealized = finiteOrNull(pos.unrealized_pnl);
  const funding = finiteOrNull(pos.unrealized_funding_pnl) ?? 0;
  const mark = unrealized == null ? null : entryPriceUsd + (unrealized - funding) / size;
  const venueMarkPriceUsd = mark != null && mark >= 0 ? mark : null;

  return {
    legId: naturalKeyOf({ ...parsed, source: 'paradex' }),
    ...parsed,
    size,
    entryPriceUsd,
    entryIv: null,
    realizedPnlUsd: finiteOrNull(pos.realized_positional_pnl) ?? 0,
    entryTs: pos.created_at ?? nowMs,
    venueHint: 'paradex',
    source: 'paradex',
    venueMarkPriceUsd,
    venueMarkTs: venueMarkPriceUsd == null ? null : nowMs,
  };
}

export function paradexPositionsToLegs(
  positions: ParadexPosition[],
  nowMs: number = Date.now(),
): PositionLeg[] {
  return positions.flatMap((pos) => {
    const leg = paradexPositionToLeg(pos, nowMs);
    return leg == null ? [] : [leg];
  });
}

export function decodeParadexJwtClaims(token: string): ParadexJwtClaims | null {
  const payload = token.split('.')[1];
  if (payload == null) return null;
  try {
    const json: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const parsed = ParadexJwtClaimsSchema.safeParse(json);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// The account-history docs leave the timestamp unit unspecified.
function paradexTimestampMs(ts: number): number {
  return Math.round(ts < 1e12 ? ts * 1000 : ts);
}

export function paradexAccountHistoryToPoints(history: ParadexAccountHistory): EquityHistoryPoint[] {
  const points: EquityHistoryPoint[] = [];
  const count = Math.min(history.data.length, history.timestamps.length);
  for (let i = 0; i < count; i += 1) {
    const equityUsd = history.data[i]!;
    if (Number.isFinite(equityUsd)) points.push({ ts: paradexTimestampMs(history.timestamps[i]!), equityUsd });
  }
  return points.sort((a, b) => a.ts - b.ts);
}
