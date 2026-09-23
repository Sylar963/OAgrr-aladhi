import { z } from 'zod';

const nullableNumber = z.number().nullable().optional();

const VenueQuoteSchema = z.object({
  bid: nullableNumber,
  ask: nullableNumber,
  mid: nullableNumber,
  bidSize: nullableNumber,
  askSize: nullableNumber,
  markIv: nullableNumber,
  delta: nullableNumber,
  gamma: nullableNumber,
  theta: nullableNumber,
  vega: nullableNumber,
  openInterest: nullableNumber,
  volume24h: nullableNumber,
  asOfMs: nullableNumber,
});
type VenueQuote = z.infer<typeof VenueQuoteSchema>;

const ChainSideSchema = z.object({
  venues: z.record(z.string(), VenueQuoteSchema),
});

export const ChainResponseSchema = z.object({
  underlying: z.string(),
  expiry: z.string(),
  expiryTs: z.number().nullable(),
  dte: z.number(),
  stats: z.object({
    forwardPriceUsd: nullableNumber,
    indexPriceUsd: nullableNumber,
    atmStrike: nullableNumber,
    atmIv: nullableNumber,
    putCallOiRatio: nullableNumber,
    totalOiUsd: nullableNumber,
    skew25d: nullableNumber,
    bfly25d: nullableNumber,
  }),
  strikes: z.array(z.object({ strike: z.number(), call: ChainSideSchema, put: ChainSideSchema })),
});
export type ChainResponse = z.infer<typeof ChainResponseSchema>;

export interface CompactChainRow {
  strike: number;
  side: 'call' | 'put';
  bestBidUsd: number | null;
  bestBidVenue: string | null;
  bestBidSize: number | null;
  bestAskUsd: number | null;
  bestAskVenue: string | null;
  bestAskSize: number | null;
  medianMidUsd: number | null;
  medianMarkIv: number | null;
  delta: number | null;
  gamma: number | null;
  thetaUsdPerDay: number | null;
  vegaUsd: number | null;
  openInterestContracts: number | null;
  volume24hContracts: number | null;
  quotingVenues: number;
}

export interface CompactChain {
  underlying: string;
  expiry: string;
  expiryIso: string | null;
  daysToExpiry: number;
  stats: {
    forwardPriceUsd: number | null;
    indexPriceUsd: number | null;
    atmStrike: number | null;
    atmIv: number | null;
    skew25d: number | null;
    bfly25d: number | null;
    putCallOiRatio: number | null;
    totalOiUsd: number | null;
  };
  strikeFilter: { minStrike: number | null; maxStrike: number | null };
  strikesAvailable: number;
  strikesReturned: number;
  rows: CompactChainRow[];
}

export interface CompactChainOptions {
  minStrike?: number | undefined;
  maxStrike?: number | undefined;
  side?: 'call' | 'put' | 'both' | undefined;
  includeStrikes?: number[] | undefined;
  maxQuoteAgeMs?: number | undefined;
  nowMs: number;
}

const DEFAULT_MAX_QUOTE_AGE_MS = 10 * 60_000;

export function round(value: number | null | undefined, digits: number): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function median(values: Array<number | null | undefined>): number | null {
  const finite = values
    .filter((value): value is number => value != null && Number.isFinite(value))
    .sort((left, right) => left - right);
  if (finite.length === 0) return null;
  const middle = Math.floor(finite.length / 2);
  return finite.length % 2 === 1
    ? (finite[middle] ?? null)
    : ((finite[middle - 1] ?? 0) + (finite[middle] ?? 0)) / 2;
}

function sum(values: Array<number | null | undefined>): number | null {
  const finite = values.filter((value): value is number => value != null && Number.isFinite(value));
  return finite.length === 0 ? null : finite.reduce((total, value) => total + value, 0);
}

function compactSide(
  strike: number,
  side: 'call' | 'put',
  venues: Record<string, VenueQuote>,
  nowMs: number,
  maxQuoteAgeMs: number,
): CompactChainRow | null {
  const fresh = Object.entries(venues).filter(
    ([, quote]) => quote.asOfMs == null || nowMs - quote.asOfMs <= maxQuoteAgeMs,
  );
  if (fresh.length === 0) return null;
  let bestBid: [string, VenueQuote] | null = null;
  let bestAsk: [string, VenueQuote] | null = null;
  for (const entry of fresh) {
    const [, quote] = entry;
    if (quote.bid != null && quote.bid > 0 && (bestBid == null || quote.bid > (bestBid[1].bid ?? 0)))
      bestBid = entry;
    if (
      quote.ask != null &&
      quote.ask > 0 &&
      (bestAsk == null || quote.ask < (bestAsk[1].ask ?? Number.POSITIVE_INFINITY))
    )
      bestAsk = entry;
  }
  const quotes = fresh.map(([, quote]) => quote);
  return {
    strike,
    side,
    bestBidUsd: round(bestBid?.[1].bid, 2),
    bestBidVenue: bestBid?.[0] ?? null,
    bestBidSize: round(bestBid?.[1].bidSize, 4),
    bestAskUsd: round(bestAsk?.[1].ask, 2),
    bestAskVenue: bestAsk?.[0] ?? null,
    bestAskSize: round(bestAsk?.[1].askSize, 4),
    medianMidUsd: round(median(quotes.map((quote) => quote.mid)), 2),
    medianMarkIv: round(median(quotes.map((quote) => quote.markIv)), 4),
    delta: round(median(quotes.map((quote) => quote.delta)), 4),
    gamma: round(median(quotes.map((quote) => quote.gamma)), 8),
    thetaUsdPerDay: round(median(quotes.map((quote) => quote.theta)), 2),
    vegaUsd: round(median(quotes.map((quote) => quote.vega)), 2),
    openInterestContracts: round(sum(quotes.map((quote) => quote.openInterest)), 2),
    volume24hContracts: round(sum(quotes.map((quote) => quote.volume24h)), 2),
    quotingVenues: fresh.length,
  };
}

export function compactChain(chain: ChainResponse, options: CompactChainOptions): CompactChain {
  const minStrike = options.minStrike ?? null;
  const maxStrike = options.maxStrike ?? null;
  const include = new Set(options.includeStrikes ?? []);
  const side = options.side ?? 'both';
  const maxQuoteAgeMs = options.maxQuoteAgeMs ?? DEFAULT_MAX_QUOTE_AGE_MS;
  const strikes = chain.strikes.filter(
    (row) =>
      include.has(row.strike) ||
      ((minStrike == null || row.strike >= minStrike) &&
        (maxStrike == null || row.strike <= maxStrike)),
  );
  const rows: CompactChainRow[] = [];
  for (const row of strikes) {
    if (side !== 'put') {
      const call = compactSide(row.strike, 'call', row.call.venues, options.nowMs, maxQuoteAgeMs);
      if (call) rows.push(call);
    }
    if (side !== 'call') {
      const put = compactSide(row.strike, 'put', row.put.venues, options.nowMs, maxQuoteAgeMs);
      if (put) rows.push(put);
    }
  }
  return {
    underlying: chain.underlying,
    expiry: chain.expiry,
    expiryIso: chain.expiryTs == null ? null : new Date(chain.expiryTs).toISOString(),
    daysToExpiry: round(chain.dte, 2) ?? chain.dte,
    stats: {
      forwardPriceUsd: round(chain.stats.forwardPriceUsd, 2),
      indexPriceUsd: round(chain.stats.indexPriceUsd, 2),
      atmStrike: chain.stats.atmStrike ?? null,
      atmIv: round(chain.stats.atmIv, 4),
      skew25d: round(chain.stats.skew25d, 4),
      bfly25d: round(chain.stats.bfly25d, 4),
      putCallOiRatio: round(chain.stats.putCallOiRatio, 3),
      totalOiUsd: round(chain.stats.totalOiUsd, 0),
    },
    strikeFilter: { minStrike, maxStrike },
    strikesAvailable: chain.strikes.length,
    strikesReturned: strikes.length,
    rows,
  };
}

const SurfaceRowSchema = z.object({
  expiry: z.string(),
  dte: z.number(),
  delta10p: nullableNumber,
  delta25p: nullableNumber,
  atm: nullableNumber,
  delta25c: nullableNumber,
  delta10c: nullableNumber,
});

export const SurfaceResponseSchema = z.object({
  underlying: z.string(),
  surface: z.array(SurfaceRowSchema),
  termStructure: z.string().nullable().optional(),
  venueAtm: z
    .record(z.string(), z.array(z.object({ expiry: z.string(), atm: nullableNumber })))
    .optional(),
});
export type SurfaceResponse = z.infer<typeof SurfaceResponseSchema>;

export interface CompactSurfaceRow {
  expiry: string;
  daysToExpiry: number;
  iv10dPut: number | null;
  iv25dPut: number | null;
  ivAtm: number | null;
  iv25dCall: number | null;
  iv10dCall: number | null;
  riskReversal25d: number | null;
  butterfly25d: number | null;
  venueAtmIv?: Record<string, number>;
}

export interface CompactSurface {
  underlying: string;
  termStructure: string | null;
  rows: CompactSurfaceRow[];
}

export function compactSurface(
  surface: SurfaceResponse,
  options: { includeVenueAtm: boolean; maxExpiries?: number },
): CompactSurface {
  const venueAtmByExpiry = new Map<string, Record<string, number>>();
  if (options.includeVenueAtm && surface.venueAtm) {
    for (const [venue, rows] of Object.entries(surface.venueAtm)) {
      for (const row of rows) {
        const atm = round(row.atm, 4);
        if (atm == null) continue;
        const entry = venueAtmByExpiry.get(row.expiry) ?? {};
        entry[venue] = atm;
        venueAtmByExpiry.set(row.expiry, entry);
      }
    }
  }
  const rows = surface.surface.slice(0, options.maxExpiries ?? surface.surface.length).map((row) => {
    const riskReversal =
      row.delta25c != null && row.delta25p != null ? row.delta25c - row.delta25p : null;
    const butterfly =
      row.delta25c != null && row.delta25p != null && row.atm != null
        ? (row.delta25c + row.delta25p) / 2 - row.atm
        : null;
    const compact: CompactSurfaceRow = {
      expiry: row.expiry,
      daysToExpiry: round(row.dte, 2) ?? row.dte,
      iv10dPut: round(row.delta10p, 4),
      iv25dPut: round(row.delta25p, 4),
      ivAtm: round(row.atm, 4),
      iv25dCall: round(row.delta25c, 4),
      iv10dCall: round(row.delta10c, 4),
      riskReversal25d: round(riskReversal, 4),
      butterfly25d: round(butterfly, 4),
    };
    const venueAtm = venueAtmByExpiry.get(row.expiry);
    if (venueAtm) compact.venueAtmIv = venueAtm;
    return compact;
  });
  return { underlying: surface.underlying, termStructure: surface.termStructure ?? null, rows };
}

const IvHistoryPointSchema = z.object({
  ts: z.number(),
  atmIv: nullableNumber,
  rr25d: nullableNumber,
  bfly25d: nullableNumber,
});

const IvHistoryTenorSchema = z.object({
  current: IvHistoryPointSchema,
  atmRank: nullableNumber,
  atmPercentile: nullableNumber,
  rrRank: nullableNumber,
  rrPercentile: nullableNumber,
  flyRank: nullableNumber,
  flyPercentile: nullableNumber,
  min: z.object({ atmIv: nullableNumber, rr25d: nullableNumber, bfly25d: nullableNumber }),
  max: z.object({ atmIv: nullableNumber, rr25d: nullableNumber, bfly25d: nullableNumber }),
  series: z.array(IvHistoryPointSchema),
});

export const IvHistoryResponseSchema = z.object({
  underlying: z.string(),
  windowDays: z.number(),
  tenors: z.record(z.string(), IvHistoryTenorSchema),
});
export type IvHistoryResponse = z.infer<typeof IvHistoryResponseSchema>;

export interface CompactIvHistoryTenor {
  current: { atmIv: number | null; riskReversal25d: number | null; butterfly25d: number | null };
  atmIvRankPct: number | null;
  atmIvPercentilePct: number | null;
  riskReversalPercentilePct: number | null;
  butterflyPercentilePct: number | null;
  windowMin: { atmIv: number | null; riskReversal25d: number | null; butterfly25d: number | null };
  windowMax: { atmIv: number | null; riskReversal25d: number | null; butterfly25d: number | null };
  dailyCloses: Array<{
    date: string;
    atmIv: number | null;
    riskReversal25d: number | null;
    butterfly25d: number | null;
  }>;
}

export function compactIvHistory(history: IvHistoryResponse): {
  underlying: string;
  windowDays: number;
  tenors: Record<string, CompactIvHistoryTenor>;
} {
  const tenors: Record<string, CompactIvHistoryTenor> = {};
  for (const [tenor, data] of Object.entries(history.tenors)) {
    const closes = new Map<string, z.infer<typeof IvHistoryPointSchema>>();
    for (const point of data.series) {
      closes.set(new Date(point.ts).toISOString().slice(0, 10), point);
    }
    tenors[tenor] = {
      current: {
        atmIv: round(data.current.atmIv, 4),
        riskReversal25d: round(data.current.rr25d, 4),
        butterfly25d: round(data.current.bfly25d, 4),
      },
      atmIvRankPct: round(data.atmRank, 1),
      atmIvPercentilePct: round(data.atmPercentile, 1),
      riskReversalPercentilePct: round(data.rrPercentile, 1),
      butterflyPercentilePct: round(data.flyPercentile, 1),
      windowMin: {
        atmIv: round(data.min.atmIv, 4),
        riskReversal25d: round(data.min.rr25d, 4),
        butterfly25d: round(data.min.bfly25d, 4),
      },
      windowMax: {
        atmIv: round(data.max.atmIv, 4),
        riskReversal25d: round(data.max.rr25d, 4),
        butterfly25d: round(data.max.bfly25d, 4),
      },
      dailyCloses: [...closes.entries()].map(([date, point]) => ({
        date,
        atmIv: round(point.atmIv, 4),
        riskReversal25d: round(point.rr25d, 4),
        butterfly25d: round(point.bfly25d, 4),
      })),
    };
  }
  return { underlying: history.underlying, windowDays: history.windowDays, tenors };
}

export const GexResponseSchema = z.object({
  underlying: z.string(),
  expiries: z.array(z.string()),
  spotPrice: nullableNumber,
  gex: z.array(z.object({ strike: z.number(), gexUsdMillions: z.number() })),
});
export type GexResponse = z.infer<typeof GexResponseSchema>;

export function compactGex(gex: GexResponse, topN = 8) {
  const byMagnitude = (left: { gexUsdMillions: number }, right: { gexUsdMillions: number }) =>
    Math.abs(right.gexUsdMillions) - Math.abs(left.gexUsdMillions);
  const toRow = (row: { strike: number; gexUsdMillions: number }) => ({
    strike: row.strike,
    gexUsdMillions: round(row.gexUsdMillions, 3),
  });
  return {
    underlying: gex.underlying,
    spotUsd: round(gex.spotPrice, 2),
    expiriesIncluded: gex.expiries,
    netGexUsdMillions: round(
      gex.gex.reduce((total, row) => total + row.gexUsdMillions, 0),
      3,
    ),
    largestPositiveStrikes: gex.gex
      .filter((row) => row.gexUsdMillions > 0)
      .sort(byMagnitude)
      .slice(0, topN)
      .map(toRow),
    largestNegativeStrikes: gex.gex
      .filter((row) => row.gexUsdMillions < 0)
      .sort(byMagnitude)
      .slice(0, topN)
      .map(toRow),
  };
}

export const BlockFlowResponseSchema = z.object({
  count: z.number(),
  trades: z.array(
    z.object({
      venue: z.string(),
      timestamp: z.number(),
      direction: z.string().nullable().optional(),
      strategy: z.string().nullable().optional(),
      legs: z.array(
        z.object({
          instrument: z.string(),
          direction: z.string(),
          size: z.number(),
          price: nullableNumber,
        }),
      ),
      totalSize: nullableNumber,
      notionalUsd: nullableNumber,
      premiumUsd: nullableNumber,
      referencePriceUsd: nullableNumber,
    }),
  ),
});
export type BlockFlowResponse = z.infer<typeof BlockFlowResponseSchema>;

export function compactBlockFlow(flow: BlockFlowResponse) {
  return {
    tradesInBuffer: flow.count,
    trades: flow.trades.map((trade) => ({
      time: new Date(trade.timestamp).toISOString(),
      venue: trade.venue,
      direction: trade.direction ?? null,
      strategy: trade.strategy ?? null,
      legs: trade.legs.map((leg) => ({
        instrument: leg.instrument,
        direction: leg.direction,
        size: leg.size,
      })),
      notionalUsd: round(trade.notionalUsd, 0),
      premiumUsd: round(trade.premiumUsd, 2),
      spotAtTradeUsd: round(trade.referencePriceUsd, 2),
    })),
  };
}
