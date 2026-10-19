import type {
  LiquidityCloseItem,
  LiquidityCloseResponse,
  PositionLeg,
  StrategyGroup,
} from '@oggregator/protocol';
import { describe, expect, it } from 'vitest';

import { closeLegParams, collarLimit, estimateClose, indexCloseItems } from './close-liquidity';

const LONG_85 = 'thalex:BTC-23OCT26-85000-P';
const SHORT_88 = 'thalex:BTC-23OCT26-88000-P';

function group(): StrategyGroup {
  return {
    groupId: 'put_spread:a+b',
    kind: 'put_spread',
    underlying: 'BTC',
    expiry: '2026-10-23',
    legIds: [LONG_85, SHORT_88],
    legs: [
      { legId: LONG_85, strike: 85000, optionRight: 'put', size: 0.03, entryPriceUsd: 3870 },
      { legId: SHORT_88, strike: 88000, optionRight: 'put', size: -0.03, entryPriceUsd: 6765 },
    ],
    netEntryPremiumUsd: -86.85,
    debitOrCredit: 'credit',
    maxProfitUsd: 86.85,
    maxLossUsd: 3.15,
    breakEvenSpotsUsd: [85105],
    grossDebitUsd: 116.1,
    grossCreditUsd: 202.95,
    totals: {
      netDeltaCoin: 0,
      netGammaUsd: 0,
      netVegaUsd: 0,
      netThetaUsd: 0,
      netVannaUsd: 0,
      netVolgaUsd: 0,
      unrealizedPnlUsd: 0,
    },
  };
}

function position(legId: string, overrides: Partial<PositionLeg> = {}): PositionLeg {
  return {
    legId,
    underlying: 'BTC',
    expiry: '2026-10-23',
    strike: 85000,
    optionRight: 'put',
    size: 0.03,
    entryPriceUsd: 1,
    entryIv: null,
    realizedPnlUsd: 0,
    entryTs: 0,
    venueHint: 'thalex',
    source: 'thalex',
    ...overrides,
  };
}

function item(
  instrument: string,
  side: 'buy' | 'sell',
  fill: { filled: number; vwap: number | null },
  markPrice: number | null,
): LiquidityCloseItem {
  return {
    instrument,
    side,
    size: 0.03,
    error: null,
    quote: {
      venue: 'thalex',
      instrument,
      priceUnit: 'usd',
      quantityUnit: 'base',
      state: 'synced',
      crossed: false,
      asOf: 0,
      bookAgeMs: 0,
      exchangeTs: null,
      mark:
        markPrice == null
          ? null
          : {
              markPrice,
              indexPrice: null,
              delta: null,
              iv: null,
              collarLow: markPrice * 0.9,
              collarHigh: markPrice * 1.1,
              ageMs: 0,
            },
      bestBid: null,
      bestAsk: null,
      spread: null,
      spreadPct: null,
      fill: {
        side,
        requested: 0.03,
        filled: fill.filled,
        fullyFilled: fill.filled >= 0.03,
        vwap: fill.vwap,
        worstPrice: fill.vwap,
        notional: (fill.vwap ?? 0) * fill.filled,
        levelsUsed: fill.filled > 0 ? 1 : 0,
        slippageVsTouch: null,
        slippageVsTouchPct: null,
        slippageVsMark: null,
        slippageVsMarkPct: null,
      },
    },
  };
}

const positions = new Map([
  [LONG_85, position(LONG_85)],
  [SHORT_88, position(SHORT_88, { strike: 88000, size: -0.03 })],
]);

function items(...list: LiquidityCloseItem[]) {
  const response: LiquidityCloseResponse = { asOf: 0, items: list };
  return indexCloseItems(response);
}

describe('closeLegParams', () => {
  it('sells longs into bids and buys shorts from asks', () => {
    expect(closeLegParams([group()], positions)).toEqual([
      'buy:0.03:BTC-23OCT26-88000-P',
      'sell:0.03:BTC-23OCT26-85000-P',
    ]);
  });

  it('skips structures held on another venue', () => {
    const deribit = new Map([
      [LONG_85, position(LONG_85, { source: 'deribit', venueHint: 'deribit' })],
      [SHORT_88, position(SHORT_88)],
    ]);
    expect(closeLegParams([group()], deribit)).toEqual([]);
    expect(estimateClose(group(), deribit, new Map(), true)).toEqual({
      status: 'unavailable',
      reason: 'held on deribit',
    });
  });
});

describe('estimateClose', () => {
  it('nets the cash to cross every leg and the slippage against mark', () => {
    const estimate = estimateClose(
      group(),
      positions,
      items(
        item('BTC-23OCT26-85000-P', 'sell', { filled: 0.03, vwap: 3115 }, 3263.47),
        item('BTC-23OCT26-88000-P', 'buy', { filled: 0.03, vwap: 6300 }, 6124.35),
      ),
      true,
    );
    expect(estimate.status).toBe('ok');
    if (estimate.status !== 'ok') return;
    // Sell 85P at 3115, buy 88P at 6300: pay (6300 - 3115) * 0.03.
    expect(estimate.cashUsd).toBeCloseTo(-95.55, 6);
    expect(estimate.markCashUsd).toBeCloseTo(-85.8264, 6);
    expect(estimate.slippageUsd).toBeCloseTo(9.7236, 6);
    expect(estimate.slippagePct).toBeCloseTo(11.33, 2);
  });

  it("flags a leg with nothing on the book as can't cross", () => {
    const estimate = estimateClose(
      group(),
      positions,
      items(
        item('BTC-23OCT26-85000-P', 'sell', { filled: 0.03, vwap: 3115 }, 3263.47),
        item('BTC-23OCT26-88000-P', 'buy', { filled: 0, vwap: null }, 6124.35),
      ),
      true,
    );
    expect(estimate).toMatchObject({ status: 'no_market', problems: ['no ask on 88,000P'] });
    if (estimate.status !== 'no_market') return;
    // Package at mark: sell 85P at 3263.47, buy 88P at 6124.35.
    expect(estimate.markCashUsd).toBeCloseTo(-85.8264, 6);
    const short88 = estimate.legs.find((l) => l.label === '88,000P')!;
    const long85 = estimate.legs.find((l) => l.label === '85,000P')!;
    expect(collarLimit(short88)).toBeCloseTo(6124.35 * 1.1, 6);
    expect(collarLimit(long85)).toBeCloseTo(3263.47 * 0.9, 6);
  });

  it('flags a book too thin for the size', () => {
    const estimate = estimateClose(
      group(),
      positions,
      items(
        item('BTC-23OCT26-85000-P', 'sell', { filled: 0.01, vwap: 3115 }, 3263.47),
        item('BTC-23OCT26-88000-P', 'buy', { filled: 0.03, vwap: 6300 }, 6124.35),
      ),
      true,
    );
    expect(estimate).toMatchObject({
      status: 'no_market',
      problems: ['85,000P only 0.01/0.03 on book'],
    });
  });

  it('reports per-leg book errors and waits for the first response', () => {
    expect(estimateClose(group(), positions, new Map(), false)).toEqual({ status: 'loading' });
    const failing = items(
      { instrument: 'BTC-23OCT26-85000-P', side: 'sell', size: 0.03, quote: null, error: 'timeout' },
      item('BTC-23OCT26-88000-P', 'buy', { filled: 0.03, vwap: 6300 }, 6124.35),
    );
    expect(estimateClose(group(), positions, failing, true)).toEqual({
      status: 'unavailable',
      reason: 'book not loading',
    });
  });

  it('leaves slippage out when a leg has no mark or mid', () => {
    const estimate = estimateClose(
      group(),
      positions,
      items(
        item('BTC-23OCT26-85000-P', 'sell', { filled: 0.03, vwap: 3115 }, null),
        item('BTC-23OCT26-88000-P', 'buy', { filled: 0.03, vwap: 6300 }, 6124.35),
      ),
      true,
    );
    expect(estimate).toMatchObject({ status: 'ok', markCashUsd: null, slippageUsd: null });
  });
});
