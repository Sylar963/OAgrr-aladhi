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
    netDeltaCoin: 0,
    optionsDeltaCoin: 0,
    linearDeltaCoin: 0,
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
  const premium = (call.entryPriceUsd + put.entryPriceUsd) * qty;
  // Guts (put strike above call strike) always pays at least the strike overlap.
  const guaranteedPayout = Math.max(0, put.strike - call.strike) * qty;
  const breakEvens = [put.strike - premium / qty, call.strike + premium / qty];
  if (isLong) {
    return {
      maxProfitUsd: null,
      maxLossUsd: premium - guaranteedPayout,
      breakEvenSpotsUsd: breakEvens,
    };
  }
  return {
    maxProfitUsd: premium - guaranteedPayout,
    maxLossUsd: null,
    breakEvenSpotsUsd: breakEvens,
  };
}

function expiryPnlAt(legs: PositionLeg[], spot: number): number {
  return legs.reduce((acc, l) => {
    const intrinsic =
      l.optionRight === 'call' ? Math.max(0, spot - l.strike) : Math.max(0, l.strike - spot);
    return acc + l.size * (intrinsic - l.entryPriceUsd);
  }, 0);
}

// Only valid when calls and puts each net to zero size, so the payoff is flat
// beyond the outer strikes and its extremes sit on strike nodes.
function balancedPayoff(legs: PositionLeg[]): {
  maxProfitUsd: number;
  maxLossUsd: number;
  breakEvenSpotsUsd: number[];
} {
  const strikes = [...new Set(legs.map((l) => l.strike))].sort((a, b) => a - b);
  const values = strikes.map((k) => expiryPnlAt(legs, k));
  const breakEvenSpotsUsd: number[] = [];
  for (let i = 0; i < strikes.length; i += 1) {
    const k0 = strikes[i]!;
    const v0 = values[i]!;
    if (v0 === 0) {
      breakEvenSpotsUsd.push(k0);
      continue;
    }
    const k1 = strikes[i + 1];
    const v1 = values[i + 1];
    if (k1 == null || v1 == null || v1 === 0 || Math.sign(v0) === Math.sign(v1)) continue;
    breakEvenSpotsUsd.push(k0 + ((k1 - k0) * -v0) / (v1 - v0));
  }
  return {
    maxProfitUsd: Math.max(...values),
    maxLossUsd: -Math.min(...values),
    breakEvenSpotsUsd,
  };
}

function singleLegPayoff(leg: PositionLeg): {
  maxProfitUsd: number | null;
  maxLossUsd: number | null;
  breakEvenSpotsUsd: number[];
} {
  const qty = Math.abs(leg.size);
  const premium = leg.entryPriceUsd * qty;
  const isCall = leg.optionRight === 'call';
  const beSpot = isCall ? leg.strike + leg.entryPriceUsd : leg.strike - leg.entryPriceUsd;
  const putFloorPayout = leg.strike * qty - premium;
  if (leg.size > 0) {
    return {
      maxProfitUsd: isCall ? null : putFloorPayout,
      maxLossUsd: premium,
      breakEvenSpotsUsd: [beSpot],
    };
  }
  return {
    maxProfitUsd: premium,
    maxLossUsd: isCall ? null : putFloorPayout,
    breakEvenSpotsUsd: [beSpot],
  };
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
  if (kind === 'iron_condor' || kind === 'iron_butterfly') {
    return { ...base, ...balancedPayoff(legs) };
  }
  if (kind === 'naked' && legs.length === 1) {
    return { ...base, ...singleLegPayoff(first) };
  }
  return {
    ...base,
    maxProfitUsd: null,
    maxLossUsd: null,
    breakEvenSpotsUsd: [],
  };
}

const PAIRING_PASSES: ReadonlySet<StrategyKind>[] = [
  new Set(['call_spread', 'put_spread']),
  new Set(['straddle', 'strangle']),
];

function withQty(leg: PositionLeg, qty: number): PositionLeg {
  return { ...leg, size: Math.sign(leg.size) * qty };
}

function spreadQty(trial: PairTrial): number {
  return Math.abs(trial.legs[0]!.size);
}

function resized(trial: PairTrial, qty: number): PairTrial {
  return { kind: trial.kind, legs: trial.legs.map((l) => withQty(l, qty)) };
}

// A vertical's expiry payoff is a ramp between its strikes; bull spreads
// (long the lower strike) ramp up, bear spreads ramp down.
function ramp(trial: PairTrial): { bull: boolean; low: number; high: number } {
  const [a, b] = trial.legs as [PositionLeg, PositionLeg];
  const lower = a.strike < b.strike ? a : b;
  return { bull: lower.size > 0, low: Math.min(a.strike, b.strike), high: Math.max(a.strike, b.strike) };
}

// One bull and one bear vertical whose ramps form a tent (short iron) or a
// trough (long iron). Judged on payoff rather than strike layout, so a bull
// call spread under a bear put spread (an iron fly built from ITM verticals)
// counts like the textbook bull put + bear call. Ramps may overlap.
function ironKind(put: PairTrial, call: PairTrial): StrategyKind | null {
  const p = ramp(put);
  const c = ramp(call);
  if (p.bull === c.bull) return null;
  const [up, down] = p.bull ? [p, c] : [c, p];
  const [first, second] =
    up.low < down.low && up.high < down.high
      ? [up, down]
      : down.low < up.low && down.high < up.high
        ? [down, up]
        : [null, null];
  if (first == null || second == null) return null;
  return first.high === second.low ? 'iron_butterfly' : 'iron_condor';
}

function mergeIronStructures(trials: PairTrial[]): PairTrial[] {
  const left = trials.map(spreadQty);
  const ironsByPut = new Map<number, PairTrial[]>();
  trials.forEach((put, i) => {
    if (put.kind !== 'put_spread') return;
    trials.forEach((call, j) => {
      if (call.kind !== 'call_spread' || left[i]! <= SIZE_EPS || left[j]! <= SIZE_EPS) return;
      const kind = ironKind(put, call);
      if (kind == null) return;
      const qty = Math.min(left[i]!, left[j]!);
      const legs = [...resized(put, qty).legs, ...resized(call, qty).legs].sort(
        (a, b) => a.strike - b.strike,
      );
      ironsByPut.set(i, [...(ironsByPut.get(i) ?? []), { kind, legs }]);
      left[i] = left[i]! - qty;
      left[j] = left[j]! - qty;
    });
  });
  return trials.flatMap((trial, i) => {
    const irons = ironsByPut.get(i) ?? [];
    if (left[i]! >= spreadQty(trial) - SIZE_EPS) return [...irons, trial];
    return left[i]! > SIZE_EPS ? [...irons, resized(trial, left[i]!)] : irons;
  });
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
    // Verticals pass first: positions are netted per instrument, so a short leg
    // that hedges a long of the same right must be paired as a defined-risk
    // spread before it can be mistaken for half of a short strangle.
    const trials: PairTrial[] = [];
    for (const pass of PAIRING_PASSES) {
      for (let i = 0; i < sorted.length; i += 1) {
        const a = sorted[i]!;
        for (let j = i + 1; j < sorted.length && left(a) > SIZE_EPS; j += 1) {
          const b = sorted[j]!;
          if (left(b) <= SIZE_EPS) continue;
          const qty = Math.min(left(a), left(b));
          const trial = classifyPair(withQty(a, qty), withQty(b, qty));
          if (trial == null || !pass.has(trial.kind)) continue;
          trials.push(trial);
          remaining.set(a.legId, left(a) - qty);
          remaining.set(b.legId, left(b) - qty);
        }
      }
    }
    for (const trial of mergeIronStructures(trials)) {
      result.push(buildGroup(trial.kind, trial.legs, marksByLeg));
    }
    for (const leg of bucket) {
      if (left(leg) <= SIZE_EPS) continue;
      result.push(buildGroup('naked', [withQty(leg, left(leg))], marksByLeg));
    }
  }
  return result;
}
