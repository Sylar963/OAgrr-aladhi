import {
  PREMIUM_SPIKE_TENORS,
  type PremiumSpikeSample,
  type PremiumSpikeTenorState,
} from '@oggregator/protocol';
import type { NormalizedOptionContract, VenueOptionChain } from '../../core/types.js';

export const PREMIUM_SPIKE_MAX_AGE_MS = 60_000;
const DAY = 86_400_000;
const localDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Los_Angeles',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const localHour = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  hour: '2-digit',
  hourCycle: 'h23',
});

function midnight(year: number, month: number, day: number): number {
  const guess = Date.UTC(year, month - 1, day, 8);
  return guess - Number(localHour.format(guess)) * 3_600_000;
}

export function premiumSpikeSession(now: number): { start: number; end: number } {
  const parts = localDate.formatToParts(now);
  const part = (name: string) => Number(parts.find((p) => p.type === name)!.value);
  const year = part('year');
  const month = part('month');
  const day = part('day');
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return {
    start: midnight(year, month, day),
    end: midnight(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate()),
  };
}

export function emptyPremiumSpikeTenors(): PremiumSpikeTenorState[] {
  return PREMIUM_SPIKE_TENORS.map((tenor, index) => ({
    tenor,
    targetDays: [30, 90, 180, 365][index]!,
    expiry: null,
    expiryTs: null,
    trackingSince: null,
    sample: null,
    putHigh: null,
    callHigh: null,
  }));
}

export function selectPremiumSpikeExpiries(
  expiries: Array<{ expiry: string; expiryTs: number | null }>,
  now: number,
): PremiumSpikeTenorState[] {
  const available = expiries
    .map((row) => ({
      expiry: row.expiry,
      expiryTs: row.expiryTs ?? Date.parse(`${row.expiry}T08:00:00Z`),
    }))
    .filter((row) => Number.isFinite(row.expiryTs) && row.expiryTs > now);
  return emptyPremiumSpikeTenors().map((row) => {
    const nearest = [...available].sort(
      (a, b) =>
        Math.abs((a.expiryTs - now) / DAY - row.targetDays) -
          Math.abs((b.expiryTs - now) / DAY - row.targetDays) || a.expiryTs - b.expiryTs,
    )[0];
    return nearest ? { ...row, ...nearest } : row;
  });
}

interface Point {
  delta: number;
  bid: number;
  ask: number;
  ts: number;
  premium: { bid: number; ask: number } | null;
  referencePriceUsd: number | null;
}
function ivPoint(contract: NormalizedOptionContract, now: number, expiryTs: number): Point | null {
  const { quote: q, greeks: g } = contract;
  const ts = q.timestamp;
  const settlement = contract.expiryTs ?? Date.parse(`${contract.expiry}T08:00:00Z`);
  if (
    settlement !== expiryTs ||
    settlement <= now ||
    ts == null ||
    !Number.isFinite(ts) ||
    ts > now ||
    now - ts > PREMIUM_SPIKE_MAX_AGE_MS ||
    g.delta == null ||
    !Number.isFinite(g.delta) ||
    (contract.right === 'put' ? g.delta >= 0 : g.delta <= 0) ||
    Math.abs(g.delta) > 1 ||
    g.bidIv == null ||
    g.askIv == null ||
    !Number.isFinite(g.bidIv) ||
    !Number.isFinite(g.askIv) ||
    g.bidIv <= 0 ||
    g.askIv < g.bidIv ||
    q.bid.usd == null ||
    q.ask.usd == null ||
    !Number.isFinite(q.bid.usd) ||
    !Number.isFinite(q.ask.usd) ||
    q.bid.usd <= 0 ||
    q.ask.usd < q.bid.usd ||
    q.bidSize == null ||
    q.askSize == null ||
    !Number.isFinite(q.bidSize) ||
    !Number.isFinite(q.askSize) ||
    q.bidSize <= 0 ||
    q.askSize <= 0
  )
    return null;
  const bid = q.bid.usdPerBase;
  const ask = q.ask.usdPerBase;
  const reference = q.indexPriceUsd;
  const premium =
    bid != null &&
    ask != null &&
    Number.isFinite(bid) &&
    Number.isFinite(ask) &&
    bid > 0 &&
    ask >= bid
      ? { bid, ask }
      : null;
  return {
    delta: Math.abs(g.delta),
    bid: g.bidIv,
    ask: g.askIv,
    ts,
    premium,
    referencePriceUsd:
      reference != null && Number.isFinite(reference) && reference > 0 ? reference : null,
  };
}

interface DeltaQuote {
  bid: number;
  ask: number;
  times: number[];
  premium: { bid: number; ask: number } | null;
  references: Array<number | null>;
}
function at25Delta(points: Point[]): DeltaQuote | null {
  const sorted = points.sort((a, b) => a.delta - b.delta || b.ts - a.ts);
  const exact = sorted.find((p) => Math.abs(p.delta - 0.25) < 1e-8);
  if (exact)
    return {
      bid: exact.bid,
      ask: exact.ask,
      times: [exact.ts],
      premium: exact.premium,
      references: [exact.referencePriceUsd],
    };
  const lo = sorted.filter((p) => p.delta < 0.25).at(-1);
  const hi = sorted.find((p) => p.delta > 0.25);
  if (!lo || !hi || lo.delta < 0.15 || hi.delta > 0.35) return null;
  const weight = (0.25 - lo.delta) / (hi.delta - lo.delta);
  return {
    bid: lo.bid + weight * (hi.bid - lo.bid),
    ask: lo.ask + weight * (hi.ask - lo.ask),
    times: [lo.ts, hi.ts],
    premium:
      lo.premium && hi.premium
        ? {
            bid: lo.premium.bid + weight * (hi.premium.bid - lo.premium.bid),
            ask: lo.premium.ask + weight * (hi.premium.ask - lo.premium.ask),
          }
        : null,
    references: [lo.referencePriceUsd, hi.referencePriceUsd],
  };
}

export function premiumSpikeSample(
  chain: VenueOptionChain,
  expiryTs: number,
  now: number,
): PremiumSpikeSample | null {
  const contracts = Object.values(chain.contracts).filter(
    (c) => c.venue === chain.venue && c.expiry === chain.expiry,
  );
  const points = (right: 'put' | 'call') =>
    contracts
      .filter((c) => c.right === right)
      .flatMap((c) => {
        const point = ivPoint(c, now, expiryTs);
        return point ? [point] : [];
      });
  const put = at25Delta(points('put'));
  const call = at25Delta(points('call'));
  if (!put || !call) return null;
  const times = [...put.times, ...call.times];
  if (Math.max(...times) - Math.min(...times) > 15_000) return null;
  const references = [...put.references, ...call.references];
  const completeReferences = references.every((value): value is number => value != null);
  const sortedReferences = completeReferences ? [...references].sort((a, b) => a - b) : [];
  const middle = Math.floor(sortedReferences.length / 2);
  const referencePriceUsd = completeReferences
    ? sortedReferences.length % 2 === 0
      ? sortedReferences[middle - 1]! / 2 + sortedReferences[middle]! / 2
      : sortedReferences[middle]!
    : null;
  return {
    observedAt: now,
    quoteAt: Math.min(...times),
    putIv: { bid: put.bid, ask: put.ask },
    callIv: { bid: call.bid, ask: call.ask },
    putSkew: { bid: put.bid - call.ask, ask: put.ask - call.bid },
    callSkew: { bid: call.bid - put.ask, ask: call.ask - put.bid },
    money: {
      referencePriceUsd,
      putPremiumUsdPerBase: put.premium,
      callPremiumUsdPerBase: call.premium,
    },
  };
}
