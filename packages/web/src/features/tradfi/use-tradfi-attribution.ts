import {
  type AttributionBar,
  type AttributionResult,
  attributePnL,
  type OptionRight,
} from '@features/chain';
import type { InstrumentCandleInterval, InstrumentCandleRange } from '@oggregator/protocol';
import { useMemo } from 'react';
import { useTradfiCandles } from './use-tradfi-candles';
import { useTradfiUnderlyingCandles } from './use-tradfi-underlying-candles';

interface CloseBar {
  ts: number;
  c: number;
}

// Join option closes to underlying closes by exact bucket timestamp. Bars without
// a forward match are dropped — attribution needs both legs at the same instant.
export function alignTradfiBars(
  option: readonly CloseBar[],
  underlying: readonly CloseBar[],
): AttributionBar[] {
  const fwd = new Map<number, number>();
  for (const u of underlying) fwd.set(u.ts, u.c);
  const out: AttributionBar[] = [];
  for (const o of option) {
    const f = fwd.get(o.ts);
    if (f == null) continue;
    out.push({ ts: o.ts, mark: o.c, forward: f });
  }
  out.sort((a, b) => a.ts - b.ts);
  return out;
}

// US equity options stop trading at the 4pm ET close. We approximate the
// expiration instant as 21:00 UTC on the expiry date (≈ 4pm EST / 5pm EDT). The
// exact close time only matters for the final hours; far-dated bars are unaffected.
export function expiryToMs(expiry: string): number {
  return Date.parse(`${expiry}T21:00:00Z`);
}

export function computeTradfiAttribution(args: {
  optionCandles: readonly CloseBar[];
  underlyingCandles: readonly CloseBar[];
  strike: number;
  right: OptionRight;
  expiry: string;
}): AttributionResult | null {
  const expirationMs = expiryToMs(args.expiry);
  if (!Number.isFinite(expirationMs)) return null;
  const bars = alignTradfiBars(args.optionCandles, args.underlyingCandles);
  if (bars.length < 2) return null;
  return attributePnL({ bars, strike: args.strike, right: args.right, expirationMs });
}

export interface UseTradfiAttributionArgs {
  underlying: string;
  expiry: string;
  strike: number | null;
  right: OptionRight;
  interval: InstrumentCandleInterval;
  range: InstrumentCandleRange;
  enabled?: boolean;
}

export function useTradfiAttribution(args: UseTradfiAttributionArgs) {
  const { underlying, expiry, strike, right, interval, range, enabled = true } = args;
  const option = useTradfiCandles({ underlying, expiry, strike, right, interval, range, enabled });
  const under = useTradfiUnderlyingCandles({ underlying, interval, range, enabled });

  const result = useMemo<AttributionResult | null>(() => {
    if (!option.data || !under.data || strike == null) return null;
    return computeTradfiAttribution({
      optionCandles: option.data.candles.map((c) => ({ ts: c.ts, c: c.c })),
      underlyingCandles: under.data.candles.map((c) => ({ ts: c.ts, c: c.c })),
      strike,
      right,
      expiry,
    });
  }, [option.data, under.data, strike, right, expiry]);

  const isLoading = option.isLoading || under.isLoading;
  const error = (option.error ?? under.error) as Error | null;
  const insufficientData = !isLoading && !error && result == null && strike != null;

  return { result, isLoading, error, insufficientData, displayCurrency: 'USD' as const };
}
