import type { EnrichedSide } from '@shared/enriched';
import { type ExecutionToll, executionToll } from '../execution-toll';
import { bestBidAsk } from '../quote-selection';

export interface EasyBuyPreview {
  type: 'call' | 'put';
  strike: number;
  venue: string;
  ask: number;
  breakeven: number;
  movePct: number;
  toll: (ExecutionToll & { breakeven: number; movePct: number }) | null;
}

export function easyBuyPreview(
  type: 'call' | 'put',
  strike: number,
  side: EnrichedSide,
  activeSet: ReadonlySet<string>,
  spot: number | null,
  now = Date.now(),
): EasyBuyPreview | null {
  if (
    spot == null ||
    !Number.isFinite(spot) ||
    spot <= 0 ||
    !Number.isFinite(strike) ||
    strike <= 0
  )
    return null;
  const { ask, askVenue } = bestBidAsk(side, activeSet, now);
  if (ask == null || !Number.isFinite(ask) || askVenue == null) return null;
  const quote = side.venues[askVenue as keyof typeof side.venues];
  const toll = executionToll(quote?.bid ?? null, ask);
  const sign = type === 'call' ? 1 : -1;
  const breakeven = strike + sign * ask;
  if (!Number.isFinite(breakeven) || breakeven <= 0) return null;
  return {
    type,
    strike,
    venue: askVenue,
    ask,
    breakeven,
    movePct: ((breakeven - spot) / spot) * 100,
    toll:
      toll == null
        ? null
        : {
            ...toll,
            breakeven: strike + sign * toll.mid,
            movePct: (toll.usd / spot) * 100,
          },
  };
}

export function fmtTollMove(value: number): string {
  if (value > 0 && value < 0.0001) return '<0.0001%';
  return `${value.toFixed(value > 0 && value < 0.01 ? 4 : 2)}%`;
}
