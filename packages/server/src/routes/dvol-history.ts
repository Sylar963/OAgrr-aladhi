import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { rollingRealizedVol } from '@oggregator/core';
import { dvolService, isDvolReady, isSpotCandlesReady, spotCandleService } from '../services.js';

// HV (realized vol) line. Deribit's get_historical_volatility is capped at
// ~16 days, so it can never span the year-long DVOL series. Compute a trailing
// 30-day realized-vol series from daily spot closes over the same window
// instead — matching DVOL's 30-day implied tenor. Mirrors the RV30d
// computation in surface.ts (realizedVol over spotCandleService daily closes).
const RV_RESOLUTION_SEC = 86_400; // daily; the literal 86400 satisfies SpotCandleResolutionSec
const RV_WINDOW_DAYS = 30;
const RV_DAILY_BUCKETS = 400; // ~1y of output plus the 30-day trailing window
const DAYS_IN_YEAR = 365;

async function realizedVolSeries(
  currency: string,
  log: FastifyBaseLogger,
): Promise<Array<{ timestamp: number; value: number }>> {
  if (!isSpotCandlesReady()) return [];
  if (currency !== 'BTC' && currency !== 'ETH') return [];
  try {
    const candles = await spotCandleService.getCandles(currency, RV_RESOLUTION_SEC, RV_DAILY_BUCKETS);
    // ×100: realizedVol returns a fraction; HvPoint values are percentages
    // (e.g. 42.0), matching the DVOL candle close convention the chart plots.
    return rollingRealizedVol(candles, RV_WINDOW_DAYS, DAYS_IN_YEAR).map((p) => ({
      timestamp: p.timestamp,
      value: p.value * 100,
    }));
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

    // Computed RV spans the full DVOL window; fall back to Deribit's short HV
    // feed only when spot candles aren't available yet (e.g. during bootstrap).
    const computed = await realizedVolSeries(currency, req.log);
    const hv = computed.length > 0 ? computed : dvolService.getHv(currency);

    return { currency, count: candles.length, candles, hv };
  });
}
