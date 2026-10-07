import {
  delta76,
  gamma76,
  type MarkContext,
  type MarkProvider,
  type PositionLeg,
  price76,
  thetaPerDay,
  vega76,
} from '@oggregator/core';

import { buildAlphaMarketContext } from '../alpha-market-context.js';
import type { MarketInjector } from '../assistant-market/market-data-reader.js';

const DAY_MS = 86_400_000;
const YEAR_SECONDS = 365 * 24 * 60 * 60;
const STRIKE_STEP = 1_000;
const STRIKE_RANGE = 0.3;

export const LISTED_EXPIRIES = [
  '2026-10-09',
  '2026-10-16',
  '2026-10-23',
  '2026-10-30',
  '2026-11-27',
  '2026-12-25',
  '2027-03-26',
];

export interface SyntheticMarketParams {
  underlying: string;
  spotUsd: number;
  nowMs: number;
  basisPerYear: number;
  atmFloor: number;
  atmFrontPremium: number;
  skew: number;
  curvature: number;
}

export function expiryMs(expiry: string): number {
  return Date.parse(`${expiry}T08:00:00.000Z`);
}

export class SyntheticMarket {
  constructor(readonly params: SyntheticMarketParams) {}

  yearsToExpiry(expiry: string): number {
    return Math.max(0, (expiryMs(expiry) - this.params.nowMs) / 1000 / YEAR_SECONDS);
  }

  forward(expiry: string): number {
    return this.params.spotUsd * (1 + this.params.basisPerYear * this.yearsToExpiry(expiry));
  }

  atmIv(expiry: string): number {
    const days = this.yearsToExpiry(expiry) * 365;
    return this.params.atmFloor + this.params.atmFrontPremium * Math.exp(-days / 14);
  }

  iv(expiry: string, strike: number): number {
    const k = Math.log(strike / this.forward(expiry));
    const days = Math.max(2, this.yearsToExpiry(expiry) * 365);
    const curvature = this.params.curvature * Math.sqrt(30 / days);
    const value = this.atmIv(expiry) + this.params.skew * k + curvature * k * k;
    return Math.min(2, Math.max(0.15, value));
  }

  mark(expiry: string, strike: number, right: 'call' | 'put'): MarkContext {
    const forward = this.forward(expiry);
    const tYears = this.yearsToExpiry(expiry);
    const iv = this.iv(expiry, strike);
    return {
      underlyingPriceUsd: this.params.spotUsd,
      forwardPriceUsd: forward,
      markPriceUsd: price76(forward, strike, iv, tYears, right),
      iv,
      delta: delta76(forward, strike, iv, tYears, right),
      gamma: gamma76(forward, strike, iv, tYears),
      vega: vega76(forward, strike, iv, tYears) / 100,
      theta: thetaPerDay(forward, strike, iv, tYears),
      yearsToExpiry: tYears,
    };
  }

  markProvider(): MarkProvider {
    return (leg: PositionLeg) => this.mark(leg.expiry, leg.strike, leg.optionRight);
  }

  strikes(): number[] {
    const low = Math.ceil((this.params.spotUsd * (1 - STRIKE_RANGE)) / STRIKE_STEP) * STRIKE_STEP;
    const high = Math.floor((this.params.spotUsd * (1 + STRIKE_RANGE)) / STRIKE_STEP) * STRIKE_STEP;
    const strikes: number[] = [];
    for (let strike = low; strike <= high; strike += STRIKE_STEP) strikes.push(strike);
    return strikes;
  }

  private strikeForDelta(expiry: string, targetDelta: number): number {
    const right = targetDelta > 0 ? 'call' : 'put';
    const forward = this.forward(expiry);
    const tYears = this.yearsToExpiry(expiry);
    let low = forward * 0.3;
    let high = forward * 3;
    for (let iteration = 0; iteration < 80; iteration += 1) {
      const mid = (low + high) / 2;
      const delta = delta76(forward, mid, this.iv(expiry, mid), tYears, right);
      if (delta > targetDelta) low = mid;
      else high = mid;
    }
    return (low + high) / 2;
  }

  private deltaIv(expiry: string, targetDelta: number): number {
    return this.iv(expiry, this.strikeForDelta(expiry, targetDelta));
  }

  private openInterest(expiry: string, strike: number): number {
    const distance = (strike - this.forward(expiry)) / (0.08 * this.params.spotUsd);
    return Math.round((40 + 900 * Math.exp(-distance * distance)) * 10) / 10;
  }

  chainResponse(expiry: string): unknown {
    const forward = this.forward(expiry);
    const tYears = this.yearsToExpiry(expiry);
    const asOfMs = this.params.nowMs - 1_500;
    const venueQuote = (strike: number, right: 'call' | 'put', spreadPct: number, size: number) => {
      const mark = this.mark(expiry, strike, right);
      const mid = mark.markPriceUsd ?? 0;
      const halfSpread = Math.max(5, mid * spreadPct);
      const oi = this.openInterest(expiry, strike) * (right === 'put' ? 0.8 : 1) * size;
      return {
        bid: mid - halfSpread > 1 ? mid - halfSpread : null,
        ask: mid + halfSpread,
        mid,
        bidSize: mid - halfSpread > 1 ? size * 5 : null,
        askSize: size * 4,
        markIv: mark.iv,
        delta: mark.delta,
        gamma: mark.gamma,
        theta: mark.theta,
        vega: mark.vega,
        openInterest: Math.round(oi),
        volume24h: Math.round(oi * 0.12),
        asOfMs,
      };
    };
    const strikes = this.strikes();
    const atmStrike = strikes.reduce((best, strike) =>
      Math.abs(strike - forward) < Math.abs(best - forward) ? strike : best,
    );
    const iv25c = this.deltaIv(expiry, 0.25);
    const iv25p = this.deltaIv(expiry, -0.25);
    const atmIv = this.atmIv(expiry);
    const totalOi = strikes.reduce((sum, strike) => sum + this.openInterest(expiry, strike) * 1.8, 0);
    return {
      underlying: this.params.underlying,
      expiry,
      expiryTs: expiryMs(expiry),
      dte: tYears * 365,
      stats: {
        forwardPriceUsd: forward,
        indexPriceUsd: this.params.spotUsd,
        atmStrike,
        atmIv,
        putCallOiRatio: 0.8,
        totalOiUsd: totalOi * this.params.spotUsd,
        skew25d: iv25c - iv25p,
        bfly25d: (iv25c + iv25p) / 2 - atmIv,
      },
      strikes: strikes.map((strike) => ({
        strike,
        call: {
          venues: {
            deribit: venueQuote(strike, 'call', 0.02, 1),
            okx: venueQuote(strike, 'call', 0.035, 0.5),
          },
        },
        put: {
          venues: {
            deribit: venueQuote(strike, 'put', 0.02, 1),
            okx: venueQuote(strike, 'put', 0.035, 0.5),
          },
        },
      })),
    };
  }

  surfaceResponse(): unknown {
    const live = LISTED_EXPIRIES.filter((expiry) => this.yearsToExpiry(expiry) > 0);
    const front = live[0];
    const back = live[live.length - 1];
    return {
      underlying: this.params.underlying,
      termStructure:
        front != null && back != null && this.atmIv(front) > this.atmIv(back)
          ? 'backwardation'
          : 'contango',
      surface: live.map((expiry) => ({
        expiry,
        dte: this.yearsToExpiry(expiry) * 365,
        delta10p: this.deltaIv(expiry, -0.1),
        delta25p: this.deltaIv(expiry, -0.25),
        atm: this.atmIv(expiry),
        delta25c: this.deltaIv(expiry, 0.25),
        delta10c: this.deltaIv(expiry, 0.1),
      })),
    };
  }

  private candles(): Array<{ timestamp: number; open: number; high: number; low: number; close: number }> {
    const count = 45;
    const dayStart = Math.floor(this.params.nowMs / DAY_MS) * DAY_MS;
    const closeAt = (index: number) => {
      const offset = count - 1 - index;
      return this.params.spotUsd * (1 + 0.035 * Math.sin(offset * 0.45) * (offset / count) + 0.012 * Math.sin(offset * 1.7));
    };
    return Array.from({ length: count }, (_, index) => {
      const close = closeAt(index);
      const open = index === 0 ? close * 0.995 : closeAt(index - 1);
      return {
        timestamp: dayStart - (count - 1 - index) * DAY_MS,
        open,
        high: Math.max(open, close) * 1.012,
        low: Math.min(open, close) * 0.988,
        close,
      };
    });
  }

  statsResponse(): unknown {
    const candles = this.candles();
    const last = candles[candles.length - 1];
    const previous = candles[candles.length - 2];
    return {
      spot: {
        price: this.params.spotUsd,
        change24hPct:
          previous == null ? null : (this.params.spotUsd / previous.close - 1) * 100,
        high24h: last?.high ?? null,
        low24h: last?.low ?? null,
      },
      dvol: {
        current: this.atmIv(LISTED_EXPIRIES[3] ?? '2026-10-30'),
        ivp: 0.42,
        ivChange1d: -0.006,
        high52w: 0.78,
        low52w: 0.33,
      },
    };
  }

  marketContextResponse(): unknown {
    return buildAlphaMarketContext({
      underlying: this.params.underlying,
      nowMs: this.params.nowMs,
      spotPrice: this.params.spotUsd,
      ivHistory: null,
      candles: this.candles(),
      regime: null,
    });
  }

  injector(): MarketInjector {
    return async (path: string) => {
      const url = new URL(path, 'http://eval.local');
      const underlying = url.searchParams.get('underlying');
      if (underlying !== this.params.underlying) return { statusCode: 404, body: { message: 'unknown underlying' } };
      switch (url.pathname) {
        case '/api/chains': {
          const expiry = url.searchParams.get('expiry') ?? '';
          if (!LISTED_EXPIRIES.includes(expiry) || this.yearsToExpiry(expiry) <= 0)
            return { statusCode: 404, body: { message: 'unknown expiry' } };
          return { statusCode: 200, body: this.chainResponse(expiry) };
        }
        case '/api/surface':
          return { statusCode: 200, body: this.surfaceResponse() };
        case '/api/stats':
          return { statusCode: 200, body: this.statsResponse() };
        case '/api/alpha/market-context':
          return { statusCode: 200, body: this.marketContextResponse() };
        default:
          return { statusCode: 404, body: { message: 'not served by the eval market' } };
      }
    };
  }
}
