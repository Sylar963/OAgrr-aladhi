import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { rollingRealizedVol } from '@oggregator/core';
import { dvolService, isDvolReady, isSpotCandlesReady, spotCandleService } from '../services.js';

// HV (realized vol) line. Deribit's get_historical_volatility is a trailing
// 15-day realized vol computed from HOURLY returns, and the endpoint serves
// only ~16 days. We reproduce that exact series from hourly spot closes
// (calibrated against the live endpoint: ~0.25pp mean abs error, 0.988
// correlation) and extend it as far back as Deribit serves hourly candles
// (~5000 points / ~208 days per call → ~193 days of HV), so the line spans far
// more than 16 days while still matching Deribit's published numbers. Daily
// sampling does not reproduce it (≈7pp error) — hourly returns are required.
const RV_RESOLUTION_SEC = 3_600; // hourly: Deribit HV is computed from hourly returns
const RV_WINDOW_HOURS = 360; // trailing 15 days (15 × 24)
const RV_HOURLY_BUCKETS = 5_000; // Deribit caps hourly history at ~5000 points (~208d) per call
const HOURS_IN_YEAR = 365 * 24;
const DAY_MS = 86_400_000;

async function realizedVolSeries(
  currency: string,
  log: FastifyBaseLogger,
): Promise<Array<{ timestamp: number; value: number }>> {
  if (!isSpotCandlesReady()) return [];
  if (currency !== 'BTC' && currency !== 'ETH') return [];
  try {
    const candles = await spotCandleService.getCandles(currency, RV_RESOLUTION_SEC, RV_HOURLY_BUCKETS);
    // Collapse the hourly RV to one point per UTC day (last hour wins). Each
    // value still derives from the trailing 360 hourly returns — so it matches
    // Deribit — but the payload and line stay daily-clean. ×100 → percentage,
    // matching the DVOL candle close convention the chart plots.
    const byDay = new Map<number, { timestamp: number; value: number }>();
    for (const p of rollingRealizedVol(candles, RV_WINDOW_HOURS, HOURS_IN_YEAR)) {
      byDay.set(Math.floor(p.timestamp / DAY_MS), { timestamp: p.timestamp, value: p.value * 100 });
    }
    return [...byDay.values()];
  } catch (err: unknown) {
    log.warn({ err: String(err), currency }, 'dvol-history: realized-vol series failed');
    return [];
  }
}

export async function dvolHistoryRoute(app: FastifyInstance) {
  app.get<{
    Querystring: { currency?: string };
  }>('/dvol-history', async (req, reply) => {
    if (!isDvolReady()) {
      return reply.status(503).send({ error: 'DVOL service not available' });
    }

    const currency = (req.query.currency ?? 'BTC').toUpperCase();
    const candles = dvolService.getHistory(currency);

    if (candles.length === 0) {
      return reply.status(404).send({ error: `No DVOL history for ${currency}` });
    }

    // Computed HV reproduces Deribit's realized vol over a long window; fall back
    // to Deribit's short HV feed only when spot candles aren't ready (bootstrap).
    const computed = await realizedVolSeries(currency, req.log);
    const hv = computed.length > 0 ? computed : dvolService.getHv(currency);

    return { currency, count: candles.length, candles, hv };
  });
}
