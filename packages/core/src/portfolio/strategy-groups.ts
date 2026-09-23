import type {
  PortfolioTotals,
  PositionLeg,
  StrategyGroup,
  StrategyKind,
} from '@oggregator/protocol';

import { computeTotals } from './aggregator.js';
import type { MarkContext } from './types.js';

const SIZE_EPS = 1e-6;

function groupByUnderlyingExpiry(legs: PositionLeg[]): Map<string, PositionLeg[]> {
  const acc = new Map<string, PositionLeg[]>();
  for (const leg of legs) {
    const key = `${leg.underlying}|${leg.expiry}`;
    const bucket = acc.get(key) ?? [];
    bucket.push(leg);
    acc.set(key, bucket);
  }
  return acc;
}

function netEntryPremium(legs: PositionLeg[]): number {
  return legs.reduce((acc, l) => acc + l.entryPriceUsd * l.size, 0);
}

function grossPremiums(legs: PositionLeg[]): { grossDebitUsd: number; grossCreditUsd: number } {
  return legs.reduce(
    (totals, leg) => {
      const premium = leg.entryPriceUsd * Math.abs(leg.size);
      if (leg.size > 0) totals.grossDebitUsd += premium;
      else totals.grossCreditUsd += premium;
      return totals;
    },
    { grossDebitUsd: 0, grossCreditUsd: 0 },
  );
}

function emptyTotals(): PortfolioTotals {
  return {
    netDeltaUsd: 0,
    netGammaUsd: 0,
    netVegaUsd: 0,
    netThetaUsd: 0,
    netVannaUsd: 0,
    netVolgaUsd: 0,
    unrealizedPnlUsd: 0,
  };
}

function debitOrCredit(netPremium: number): 'debit' | 'credit' | 'flat' {
  if (netPremium > SIZE_EPS) return 'debit';
  if (netPremium < -SIZE_EPS) return 'credit';
  return 'flat';
}

function groupIdOf(prefix: StrategyKind, legs: PositionLeg[]): string {
  const ids = legs
    .map((l) => l.legId)
    .sort()
    .join('+');
  return `${prefix}:${ids}`;
}

interface PairTrial {
  kind: StrategyKind;
  legs: PositionLeg[];
}

// Try to pair two legs into a recognized 2-leg structure. Returns null when
// the pair is not a structure we model. Sizes are matched by the caller.
function classifyPair(a: PositionLeg, b: PositionLeg): PairTrial | null {
  const sameRight = a.optionRight === b.optionRight;
  const sameStrike = a.strike === b.strike;
  const oppositeSign = Math.sign(a.size) !== Math.sign(b.size);
  const sameSign = Math.sign(a.size) === Math.sign(b.size);

  if (sameRight && oppositeSign && !sameStrike) {
    return { kind: a.optionRight === 'call' ? 'call_spread' : 'put_spread', legs: [a, b] };
  }
  if (!sameRight && sameSign && sameStrike) {
    return { kind: 'straddle', legs: [a, b] };
  }
  if (!sameRight && sameSign && !sameStrike) {
    return { kind: 'strangle', legs: [a, b] };
  }
  return null;
}

function verticalPayoff(legs: PositionLeg[]): {
  maxProfitUsd: number;
  maxLossUsd: number;
  breakEvenSpotsUsd: number[];
} | null {
  if (legs.length !== 2) return null;
  const [a, b] = legs;
  if (a == null || b == null) return null;
  const long = a.size > 0 ? a : b;
  const short = a.size > 0 ? b : a;
  if (long.size <= 0 || short.size >= 0) return null;
  const qty = Math.abs(long.size);
  const strikeWidth = Math.abs(long.strike - short.strike);
  const net = long.entryPriceUsd * long.size + short.entryPriceUsd * short.size;
  // net > 0 = debit (we paid). net < 0 = credit (we collected).
  const maxStructurePayout = strikeWidth * qty;
  if (net >= 0) {
    // Debit vertical
    const debit = net;
    const maxProfitUsd = maxStructurePayout - debit;
    const maxLossUsd = debit;
    // BE spot: for long call spread S = lowK + debit/qty;
    //          for long put spread  S = highK - debit/qty.
    const beSpot =
      long.optionRight === 'call'
        ? Math.min(long.strike, short.strike) + debit / qty
        : Math.max(long.strike, short.strike) - debit / qty;
    return { maxProfitUsd, maxLossUsd, breakEvenSpotsUsd: [beSpot] };
  }
  const credit = -net;
  const maxProfitUsd = credit;
  const maxLossUsd = maxStructurePayout - credit;
  const beSpot =
    long.optionRight === 'call'
      ? Math.min(long.strike, short.strike) + credit / qty
      : Math.max(long.strike, short.strike) - credit / qty;
  return { maxProfitUsd, maxLossUsd, breakEvenSpotsUsd: [beSpot] };
}

function straddleStranglePayoff(legs: PositionLeg[]): {
  maxProfitUsd: number | null;
  maxLossUsd: number | null;
  breakEvenSpotsUsd: number[];
} | null {
  if (legs.length !== 2) return null;
  const [a, b] = legs;
  if (a == null || b == null) return null;
  const sameSign = Math.sign(a.size) === Math.sign(b.size);
  if (!sameSign) return null;
  const isLong = a.size > 0;
  const qty = Math.abs(a.size);
  const call = a.optionRight === 'call' ? a : b;
  const put = a.optionRight === 'put' ? a : b;
  if (call.optionRight !== 'call' || put.optionRight !== 'put') return null;
  const netDebit = (call.entryPriceUsd + put.entryPriceUsd) * Math.abs(a.size);
  if (isLong) {
    // Long straddle/strangle: max loss = debit paid; max profit unbounded
    // on the upside and capped at strike-floor on the downside, so report
    // unbounded.
    const breakEvens = [
      put.strike - netDebit / qty,
      call.strike + netDebit / qty,
    ];
    return { maxProfitUsd: null, maxLossUsd: netDebit, breakEvenSpotsUsd: breakEvens };
  }
  // Short straddle/strangle: max profit = credit, max loss unbounded.
  const breakEvens = [
    put.strike - netDebit / qty,
    call.strike + netDebit / qty,
  ];
  return { maxProfitUsd: netDebit, maxLossUsd: null, breakEvenSpotsUsd: breakEvens };
}

function buildGroup(
  kind: StrategyKind,
  legs: PositionLeg[],
  marksByLeg: ReadonlyMap<string, MarkContext>,
): StrategyGroup {
  const first = legs[0]!;
  const net = netEntryPremium(legs);
  const premiums = grossPremiums(legs);
  const marked = legs.flatMap((leg) => {
    const mark = marksByLeg.get(leg.legId);
    return mark == null ? [] : [{ leg, mark }];
  });
  const base = {
    groupId: groupIdOf(kind, legs),
    kind,
    underlying: first.underlying,
    expiry: first.expiry,
    legIds: legs.map((l) => l.legId),
    legs: legs.map((l) => ({
      legId: l.legId,
      strike: l.strike,
      optionRight: l.optionRight,
      size: l.size,
      entryPriceUsd: l.entryPriceUsd,
    })),
    netEntryPremiumUsd: net,
    debitOrCredit: debitOrCredit(net),
    ...premiums,
    totals: marked.length === legs.length ? computeTotals(marked) : emptyTotals(),
  } satisfies Pick<
    StrategyGroup,
    'groupId' | 'kind' | 'underlying' | 'expiry' | 'legIds' | 'legs' | 'netEntryPremiumUsd' |
    'debitOrCredit' | 'grossDebitUsd' | 'grossCreditUsd' | 'totals'
  >;

  if (kind === 'call_spread' || kind === 'put_spread') {
    const payoff = verticalPayoff(legs);
    return {
      ...base,
      maxProfitUsd: payoff?.maxProfitUsd ?? null,
      maxLossUsd: payoff?.maxLossUsd ?? null,
      breakEvenSpotsUsd: payoff?.breakEvenSpotsUsd ?? [],
    };
  }
  if (kind === 'straddle' || kind === 'strangle') {
    const payoff = straddleStranglePayoff(legs);
    return {
      ...base,
      maxProfitUsd: payoff?.maxProfitUsd ?? null,
      maxLossUsd: payoff?.maxLossUsd ?? null,
      breakEvenSpotsUsd: payoff?.breakEvenSpotsUsd ?? [],
    };
  }
  return {
    ...base,
    maxProfitUsd: null,
    maxLossUsd: null,
    breakEvenSpotsUsd: [],
  };
}

function withQty(leg: PositionLeg, qty: number): PositionLeg {
  return { ...leg, size: Math.sign(leg.size) * qty };
}

export function detectStrategyGroups(
  legs: PositionLeg[],
  marksByLeg: ReadonlyMap<string, MarkContext> = new Map(),
): StrategyGroup[] {
  const result: StrategyGroup[] = [];
  for (const bucket of groupByUnderlyingExpiry(legs).values()) {
    // Unequal sizes pair at the smaller quantity; the excess stays available
    // for another pair or falls through as a single leg.
    const remaining = new Map(bucket.map((leg) => [leg.legId, Math.abs(leg.size)]));
    const left = (leg: PositionLeg) => remaining.get(leg.legId) ?? 0;
    // Greedy 2-leg pairing pass. Order by strike+right so deterministic.
    const sorted = [...bucket].sort((a, b) => {
      if (a.strike !== b.strike) return a.strike - b.strike;
      if (a.optionRight !== b.optionRight) return a.optionRight < b.optionRight ? -1 : 1;
      if (a.legId === b.legId) return 0;
      return a.legId < b.legId ? -1 : 1;
    });
    for (let i = 0; i < sorted.length; i += 1) {
      const a = sorted[i]!;
      for (let j = i + 1; j < sorted.length && left(a) > SIZE_EPS; j += 1) {
        const b = sorted[j]!;
        if (left(b) <= SIZE_EPS) continue;
        const qty = Math.min(left(a), left(b));
        const trial = classifyPair(withQty(a, qty), withQty(b, qty));
        if (trial == null) continue;
        result.push(buildGroup(trial.kind, trial.legs, marksByLeg));
        remaining.set(a.legId, left(a) - qty);
        remaining.set(b.legId, left(b) - qty);
      }
    }
    for (const leg of bucket) {
      if (left(leg) <= SIZE_EPS) continue;
      result.push(buildGroup('naked', [withQty(leg, left(leg))], marksByLeg));
    }
  }
  return result;
}
