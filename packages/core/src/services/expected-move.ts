import type {
  EnrichedChainResponse,
  ExpectedMoveSession,
  ExpectedStraddleQuery,
  ExpectedStraddleResponse,
  VenueQuote,
} from '@oggregator/protocol';
import { price76, solveIv } from '../feeds/thalex/bs-solver.js';
import type { SpotCandle } from './spot-candles.js';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const QUOTE_MAX_AGE_MS = 90_000;
export const STRADDLE_MAD_FACTOR = Math.sqrt(2 / Math.PI);

function positive(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value) && value > 0;
}

export function expectedMoveFraction(
  iv: number,
  periodsPerYear: 252 | 365,
  periods = 1,
): number | null {
  return positive(iv) && positive(periods) ? iv * Math.sqrt(periods / periodsPerYear) : null;
}

export interface ExpectedMoveSessionInput {
  startMs: number;
  endMs: number;
  open: number;
  last: number;
  high: number;
  low: number;
  priceAsOfMs: number;
  openingIv: number | null;
  ivAsOfMs: number | null;
  complete: boolean;
  coverage: 'complete' | 'partial';
  periodsPerYear: 252 | 365;
}

export function buildExpectedMoveSession(
  input: ExpectedMoveSessionInput,
): ExpectedMoveSession | null {
  if (
    ![input.open, input.last, input.high, input.low].every(positive) ||
    input.high < Math.max(input.open, input.last) ||
    input.low > Math.min(input.open, input.last) ||
    input.startMs >= input.endMs
  )
    return null;
  const openingIv =
    positive(input.openingIv) && input.ivAsOfMs != null && input.ivAsOfMs <= input.startMs
      ? input.openingIv
      : null;
  const expectedFraction =
    openingIv == null ? null : expectedMoveFraction(openingIv, input.periodsPerYear);
  const expectedUsd = expectedFraction == null ? null : input.open * expectedFraction;
  const returnFraction = input.last / input.open - 1;
  const absoluteReturnFraction = Math.abs(returnFraction);
  const moveRatio = expectedFraction == null ? null : absoluteReturnFraction / expectedFraction;
  const classification =
    input.coverage === 'partial' || moveRatio == null
      ? 'unavailable'
      : !input.complete
        ? 'in-progress'
        : Math.abs(moveRatio - 1) < 1e-8
          ? 'at-benchmark'
          : moveRatio > 1
            ? 'large'
            : 'small';
  const { periodsPerYear: _periods, ...session } = input;
  return {
    ...session,
    openingIv,
    ivAsOfMs: openingIv == null ? null : input.ivAsOfMs,
    expectedFraction,
    expectedUsd,
    approximateStraddleUsd: expectedUsd == null ? null : STRADDLE_MAD_FACTOR * expectedUsd,
    lower: expectedUsd == null ? null : input.open - expectedUsd,
    upper: expectedUsd == null ? null : input.open + expectedUsd,
    returnFraction,
    absoluteReturnFraction,
    rangeFraction: (input.high - input.low) / input.open,
    moveRatio,
    classification,
  };
}

export function buildCryptoMoveSessions(input: {
  candles: readonly SpotCandle[];
  ivCandles: readonly SpotCandle[];
  anchorHour: 0 | 8;
  days: number;
  nowMs: number;
  latest: { price: number; asOfMs: number } | null;
}): ExpectedMoveSession[] {
  const { nowMs, anchorHour, days } = input;
  const offset = anchorHour * HOUR_MS;
  const currentStart = Math.floor((nowMs - offset) / DAY_MS) * DAY_MS + offset;
  const candles = new Map(input.candles.map((c) => [c.timestamp, c]));
  const ivCandles = new Map(input.ivCandles.map((c) => [c.timestamp, c]));
  const sessions: ExpectedMoveSession[] = [];
  for (let day = days; day >= 0; day--) {
    const startMs = currentStart - day * DAY_MS;
    const endMs = startMs + DAY_MS;
    const first = candles.get(startMs);
    if (first == null) continue;
    const bars: SpotCandle[] = [];
    const expectedBars = Math.min(24, Math.floor((nowMs - startMs) / HOUR_MS) + 1);
    for (let hour = 0; hour < expectedBars; hour++) {
      const bar = candles.get(startMs + hour * HOUR_MS);
      if (bar) bars.push(bar);
    }
    const last = bars.at(-1);
    if (last == null) continue;
    // Use the preceding completed IV hour: its close was available at the anchor.
    const opening = ivCandles.get(startMs - HOUR_MS);
    const latest =
      input.latest != null &&
      input.latest.asOfMs >= startMs &&
      input.latest.asOfMs < endMs &&
      input.latest.asOfMs <= nowMs &&
      nowMs - input.latest.asOfMs <= 120_000
        ? input.latest
        : null;
    const complete = endMs <= nowMs;
    const session = buildExpectedMoveSession({
      startMs,
      endMs,
      open: first.open,
      last: latest?.price ?? last.close,
      high: Math.max(...bars.map((b) => b.high), latest?.price ?? last.high),
      low: Math.min(...bars.map((b) => b.low), latest?.price ?? last.low),
      priceAsOfMs: latest?.asOfMs ?? Math.min(nowMs, last.timestamp + HOUR_MS),
      openingIv: opening?.close ?? null,
      ivAsOfMs: opening == null ? null : startMs,
      complete,
      coverage:
        bars.length === expectedBars && (complete || latest != null) ? 'complete' : 'partial',
      periodsPerYear: 365,
    });
    if (session) sessions.push(session);
  }
  return sessions;
}

function venueQuote(side: { venues: Partial<Record<string, VenueQuote>> }, venue: string) {
  return side.venues[venue];
}

function fresh(quote: VenueQuote | undefined, nowMs: number): quote is VenueQuote {
  return (
    quote?.asOfMs != null &&
    nowMs - quote.asOfMs <= QUOTE_MAX_AGE_MS &&
    quote.asOfMs <= nowMs + 5_000
  );
}

function book(quote: VenueQuote | undefined): quote is VenueQuote & { bid: number; ask: number } {
  return (
    quote != null &&
    positive(quote.bid) &&
    positive(quote.ask) &&
    quote.ask >= quote.bid &&
    positive(quote.bidSize) &&
    positive(quote.askSize)
  );
}

export function evaluateExpectedStraddle(
  chain: EnrichedChainResponse | null,
  query: ExpectedStraddleQuery,
  indexIv: number | null,
  nowMs: number,
): ExpectedStraddleResponse {
  const result: ExpectedStraddleResponse = {
    ...query,
    generatedAt: nowMs,
    status: 'unavailable',
    strike: null,
    forward: null,
    expiryTs: null,
    quoteAsOfMs: null,
    bid: null,
    ask: null,
    mid: null,
    bidSize: null,
    askSize: null,
    indexIv: positive(indexIv) ? indexIv : null,
    indexModel: null,
    surfaceIv: null,
    surfaceModel: null,
    surfaceStrikes: [],
    indexDifferenceFraction: null,
    surfaceDifferenceFraction: null,
  };
  if (chain == null || chain.underlying !== query.underlying || chain.expiry !== query.expiry)
    return result;
  const forward = chain.stats.forwardPriceUsd;
  if (!positive(forward)) return { ...result, status: 'missing-forward' };
  result.forward = forward;
  const rows = chain.strikes
    .filter((row) => positive(row.strike))
    .sort((a, b) => a.strike - b.strike);
  const atm = rows.reduce<(typeof rows)[number] | null>(
    (best, row) =>
      best == null ||
      Math.abs(Math.log(row.strike / forward)) < Math.abs(Math.log(best.strike / forward))
        ? row
        : best,
    null,
  );
  if (atm == null) return { ...result, status: 'missing-quotes' };
  result.strike = atm.strike;
  const call = venueQuote(atm.call, query.venue);
  const put = venueQuote(atm.put, query.venue);
  if (!book(call) || !book(put)) return { ...result, status: 'missing-quotes' };
  if (
    (call.inverse != null && put.inverse != null && call.inverse !== put.inverse) ||
    (call.execution != null &&
      put.execution != null &&
      call.execution.settleCurrency !== put.execution.settleCurrency)
  ) {
    return { ...result, status: 'missing-quotes' };
  }
  if (!fresh(call, nowMs) || !fresh(put, nowMs)) return { ...result, status: 'stale-quotes' };
  const expiryTs = call.execution?.expiryTs ?? chain.expiryTs;
  const putExpiryTs = put.execution?.expiryTs ?? chain.expiryTs;
  if (!positive(expiryTs) || expiryTs !== putExpiryTs || expiryTs <= nowMs) {
    return { ...result, status: 'missing-expiry' };
  }
  if (
    [call, put].some(
      (q) =>
        !positive(q.underlyingPriceUsd) || Math.abs(q.underlyingPriceUsd / forward - 1) > 0.005,
    )
  ) {
    return { ...result, status: 'missing-forward' };
  }
  const tYears = (expiryTs - nowMs) / (365 * DAY_MS);
  const model = (iv: number) =>
    price76(forward, atm.strike, iv, tYears, 'call') +
    price76(forward, atm.strike, iv, tYears, 'put');
  const bid = call.bid + put.bid;
  const ask = call.ask + put.ask;
  const mid = (bid + ask) / 2;
  const neighbors = rows.flatMap((row) => {
    if (row.strike === atm.strike || Math.abs(Math.log(row.strike / forward)) > 0.15) return [];
    const right = row.strike < forward ? 'put' : 'call';
    const quote = venueQuote(row[right], query.venue);
    if (
      !book(quote) ||
      !fresh(quote, nowMs) ||
      (quote.execution?.expiryTs ?? chain.expiryTs) !== expiryTs ||
      !positive(quote.underlyingPriceUsd) ||
      Math.abs(quote.underlyingPriceUsd / forward - 1) > 0.005
    )
      return [];
    const iv = solveIv({
      price: (quote.bid + quote.ask) / 2,
      forward,
      strike: row.strike,
      tYears,
      right,
      seed: quote.markIv,
    });
    return positive(iv) ? [{ strike: row.strike, iv }] : [];
  });
  const lower = neighbors.filter((p) => p.strike < atm.strike).at(-1);
  const upper = neighbors.find((p) => p.strike > atm.strike);
  let surfaceIv: number | null = null;
  if (lower != null && upper != null) {
    const weight = Math.log(atm.strike / lower.strike) / Math.log(upper.strike / lower.strike);
    surfaceIv = Math.sqrt(lower.iv ** 2 * (1 - weight) + upper.iv ** 2 * weight);
  }
  const indexModel = positive(indexIv) ? model(indexIv) : null;
  const surfaceModel = surfaceIv == null ? null : model(surfaceIv);
  return {
    ...result,
    status: 'available',
    expiryTs,
    quoteAsOfMs: Math.min(call.asOfMs!, put.asOfMs!),
    bid,
    ask,
    mid,
    bidSize: Math.min(call.bidSize!, put.bidSize!),
    askSize: Math.min(call.askSize!, put.askSize!),
    indexModel,
    surfaceIv,
    surfaceModel,
    surfaceStrikes:
      surfaceIv == null || lower == null || upper == null ? [] : [lower.strike, upper.strike],
    indexDifferenceFraction: positive(indexModel) ? mid / indexModel - 1 : null,
    surfaceDifferenceFraction: positive(surfaceModel) ? mid / surfaceModel - 1 : null,
  };
}
