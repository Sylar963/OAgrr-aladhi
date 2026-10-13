import type { PublicPositionDto } from '@oggregator/protocol';

export interface PositionGroup {
  key: string;
  underlying: string;
  expiry: string;
  legs: PublicPositionDto[];
  unrealizedPnlUsd: number | null;
}

export interface PayoffSummary {
  /** Null when the payoff grows without bound as the underlying rises. */
  maxProfitUsd: number | null;
  maxLossUsd: number | null;
  breakevens: number[];
}

export interface PayoffPoint {
  price: number;
  pnl: number;
}

export function groupPositions(positions: PublicPositionDto[]): PositionGroup[] {
  const groups = new Map<string, PositionGroup>();
  for (const leg of positions) {
    const key = `${leg.underlying}|${leg.expiry}`;
    const group = groups.get(key) ?? {
      key,
      underlying: leg.underlying,
      expiry: leg.expiry,
      legs: [],
      unrealizedPnlUsd: null,
    };
    group.legs.push(leg);
    if (leg.unrealizedPnlUsd != null) {
      group.unrealizedPnlUsd = (group.unrealizedPnlUsd ?? 0) + leg.unrealizedPnlUsd;
    }
    groups.set(key, group);
  }
  return [...groups.values()].sort(
    (a, b) => a.expiry.localeCompare(b.expiry) || a.underlying.localeCompare(b.underlying),
  );
}

export function payoffAt(legs: PublicPositionDto[], price: number): number {
  let pnl = 0;
  for (const leg of legs) {
    const intrinsic =
      leg.optionRight === 'call'
        ? Math.max(0, price - leg.strike)
        : Math.max(0, leg.strike - price);
    pnl += leg.netQuantity * (intrinsic - leg.avgEntryPriceUsd);
  }
  return pnl;
}

function kinks(legs: PublicPositionDto[]): number[] {
  return [...new Set(legs.map((leg) => leg.strike))].sort((a, b) => a - b);
}

/** Exact for same-expiry legs: the payoff is piecewise linear with kinks only at strikes. */
export function payoffSummary(legs: PublicPositionDto[]): PayoffSummary {
  const prices = [0, ...kinks(legs)];
  const values = prices.map((price) => payoffAt(legs, price));
  const slopeAbove = legs.reduce(
    (sum, leg) => sum + (leg.optionRight === 'call' ? leg.netQuantity : 0),
    0,
  );

  const breakevens: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const a = values[i - 1]!;
    const b = values[i]!;
    if (a === 0) breakevens.push(prices[i - 1]!);
    else if (a * b < 0) {
      breakevens.push(prices[i - 1]! + (a / (a - b)) * (prices[i]! - prices[i - 1]!));
    }
  }
  const last = values.at(-1)!;
  if (last === 0 && prices.length > 1) breakevens.push(prices.at(-1)!);
  else if (slopeAbove !== 0 && last * slopeAbove < 0) {
    breakevens.push(prices.at(-1)! - last / slopeAbove);
  }

  return {
    maxProfitUsd: slopeAbove > 0 ? null : Math.max(...values),
    maxLossUsd: slopeAbove < 0 ? null : Math.min(...values),
    breakevens: breakevens.filter((price) => price > 0),
  };
}

export function payoffRange(
  legs: PublicPositionDto[],
  spot: number | null,
  breakevens: number[],
): [number, number] {
  const anchors = [...legs.map((leg) => leg.strike), ...breakevens];
  if (spot != null && spot > 0) anchors.push(spot);
  const lo = Math.min(...anchors);
  const hi = Math.max(...anchors);
  const pad = Math.max((hi - lo) * 0.35, hi * 0.04);
  return [Math.max(0, lo - pad), hi + pad];
}

export function payoffPoints(legs: PublicPositionDto[], from: number, to: number): PayoffPoint[] {
  const prices = [from, ...kinks(legs).filter((strike) => strike > from && strike < to), to];
  return prices.map((price) => ({ price, pnl: payoffAt(legs, price) }));
}

export function strategyName(legs: PublicPositionDto[]): string {
  if (legs.length === 1) {
    const leg = legs[0]!;
    return `${leg.netQuantity > 0 ? 'Long' : 'Short'} ${leg.optionRight === 'call' ? 'Call' : 'Put'}`;
  }
  if (legs.length === 2) {
    const [a, b] = [...legs].sort((x, y) => x.strike - y.strike) as [
      PublicPositionDto,
      PublicPositionDto,
    ];
    const opposite = Math.sign(a.netQuantity) !== Math.sign(b.netQuantity);
    if (a.optionRight === b.optionRight && opposite) {
      const longLow = a.netQuantity > 0;
      if (a.optionRight === 'call') return longLow ? 'Bull Call Spread' : 'Bear Call Spread';
      return longLow ? 'Bull Put Spread' : 'Bear Put Spread';
    }
    if (a.optionRight !== b.optionRight && !opposite) {
      const side = a.netQuantity > 0 ? 'Long' : 'Short';
      return a.strike === b.strike ? `${side} Straddle` : `${side} Strangle`;
    }
    if (a.optionRight === b.optionRight && a.strike === b.strike) return 'Net Position';
  }
  if (legs.length === 4) {
    const puts = legs.filter((leg) => leg.optionRight === 'put');
    const calls = legs.filter((leg) => leg.optionRight === 'call');
    if (puts.length === 2 && calls.length === 2) {
      const shortBody = [...puts, ...calls]
        .sort((x, y) => x.strike - y.strike)
        .slice(1, 3)
        .every((leg) => leg.netQuantity < 0);
      const longBody = [...puts, ...calls]
        .sort((x, y) => x.strike - y.strike)
        .slice(1, 3)
        .every((leg) => leg.netQuantity > 0);
      if (shortBody) return 'Iron Condor';
      if (longBody) return 'Reverse Iron Condor';
    }
  }
  return `${legs.length}-leg Custom`;
}
