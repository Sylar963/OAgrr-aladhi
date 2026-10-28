import type { CloseNowLeg, PortfolioCloseNow, StrategyGroup } from '@oggregator/protocol';
import { describe, expect, it } from 'vitest';

import { collarLimit, estimateClose } from './close-liquidity';

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
      optionsDeltaCoin: 0,
      linearDeltaCoin: 0,
      netGammaUsd: 0,
      netVegaUsd: 0,
      netThetaUsd: 0,
      netVannaUsd: 0,
      netVolgaUsd: 0,
      unrealizedPnlUsd: 0,
    },
  };
}

function quote(
  legId: string,
  side: 'buy' | 'sell',
  fill: { filled: number; vwap: number | null },
  markPrice: number | null,
  overrides: Partial<CloseNowLeg> = {},
): CloseNowLeg {
  const notional = (fill.vwap ?? 0) * fill.filled;
  const full = fill.filled >= 0.03;
  const empty = fill.filled === 0;
  return {
    legId,
    venue: 'thalex',
    instrument: null,
    status: full ? 'ok' : empty ? (side === 'buy' ? 'no_ask' : 'no_bid') : 'partial',
    unavailableReason: null,
    side,
    size: 0.03,
    filledSize: fill.filled,
    exitVwapUsd: fill.vwap,
    feesUsd: 0,
    exitCashUsd: side === 'sell' ? notional : empty ? null : -notional,
    venueMarkUsd: markPrice,
    collarLimitUsd: markPrice == null ? null : side === 'buy' ? markPrice * 1.1 : markPrice * 0.9,
    markPnlUsd: null,
    closeNowPnlUsd: null,
    exitCostUsd: null,
    giveBackPct: null,
    spread: null,
    stale: false,
    bookAgeMs: 0,
    peak: null,
    ...overrides,
  };
}

function closeNow(...legs: CloseNowLeg[]): PortfolioCloseNow {
  const aggregate = {
    markPnlUsd: null,
    closeNowPnlUsd: null,
    exitCostUsd: null,
    giveBackPct: null,
    exitCashUsd: null,
    feesUsd: 0,
    legCount: legs.length,
    pricedLegCount: 0,
    complete: false,
    stale: false,
    peak: null,
  };
  return { computedAt: 0, legs, strategies: [{ groupId: group().groupId, ...aggregate }], portfolio: aggregate };
}

describe('estimateClose', () => {
  it('nets the cash to cross every leg and the slippage against mark', () => {
    const estimate = estimateClose(
      group(),
      closeNow(
        quote(LONG_85, 'sell', { filled: 0.03, vwap: 3115 }, 3263.47),
        quote(SHORT_88, 'buy', { filled: 0.03, vwap: 6300 }, 6124.35),
      ),
    );
    expect(estimate.status).toBe('ok');
    if (estimate.status !== 'ok') return;
    // Sell 85P at 3115, buy 88P at 6300: pay (6300 - 3115) * 0.03.
    expect(estimate.cashUsd).toBeCloseTo(-95.55, 6);
    expect(estimate.pnlUsd).toBeCloseTo(-8.70, 6);
    expect(estimate.markCashUsd).toBeCloseTo(-85.8264, 6);
    expect(estimate.slippageUsd).toBeCloseTo(9.7236, 6);
    expect(estimate.slippagePct).toBeCloseTo(11.33, 2);
    expect(estimate.strategy?.groupId).toBe(group().groupId);
  });

  it('includes taker fees in the cash to close', () => {
    const estimate = estimateClose(
      group(),
      closeNow(
        quote(LONG_85, 'sell', { filled: 0.03, vwap: 3115 }, 3263.47, { exitCashUsd: 3115 * 0.03 - 0.5 }),
        quote(SHORT_88, 'buy', { filled: 0.03, vwap: 6300 }, 6124.35, { exitCashUsd: -(6300 * 0.03 + 0.5) }),
      ),
    );
    expect(estimate).toMatchObject({ status: 'ok' });
    if (estimate.status !== 'ok') return;
    expect(estimate.cashUsd).toBeCloseTo(-96.55, 6);
    expect(estimate.pnlUsd).toBeCloseTo(-9.70, 6);
  });

  it('allocates shared positions by strategy size without double-counting cash or fees', () => {
    const full = group();
    const half: StrategyGroup = {
      ...full,
      legs: full.legs.map((leg) => ({ ...leg, size: leg.size / 2 })),
      netEntryPremiumUsd: full.netEntryPremiumUsd / 2,
    };
    const books = closeNow(
      quote(LONG_85, 'sell', { filled: 0.03, vwap: 3115 }, 3263.47, { feesUsd: 0.5, exitCashUsd: 92.95 }),
      quote(SHORT_88, 'buy', { filled: 0.03, vwap: 6300 }, 6124.35, { feesUsd: 0.5, exitCashUsd: -189.5 }),
    );
    const estimate = estimateClose(half, books);
    expect(estimate.status).toBe('ok');
    if (estimate.status !== 'ok') return;
    expect(estimate.cashUsd).toBeCloseTo(-48.275);
    expect(estimate.pnlUsd).toBeCloseTo(-4.85);
    expect(estimate.feesUsd).toBe(0.5);
    expect(estimate.markCashUsd).toBeCloseTo(-85.8264 / 2);
    expect(estimate.legs.map((leg) => leg.size)).toEqual([0.015, 0.015]);
  });

  it('waits for an updated quote when the position changes side or grows', () => {
    const books = closeNow(
      quote(LONG_85, 'sell', { filled: 0.03, vwap: 3115 }, 3263.47),
      quote(SHORT_88, 'buy', { filled: 0.03, vwap: 6300 }, 6124.35),
    );
    for (const size of [-0.03, 0.04]) {
      const changed = group();
      changed.legs[0]!.size = size;
      expect(estimateClose(changed, books)).toEqual({ status: 'loading' });
    }
  });

  it("flags a leg with nothing on the book as can't cross", () => {
    const estimate = estimateClose(
      group(),
      closeNow(
        quote(LONG_85, 'sell', { filled: 0.03, vwap: 3115 }, 3263.47),
        quote(SHORT_88, 'buy', { filled: 0, vwap: null }, 6124.35),
      ),
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
      closeNow(
        quote(LONG_85, 'sell', { filled: 0.01, vwap: 3115 }, 3263.47),
        quote(SHORT_88, 'buy', { filled: 0.03, vwap: 6300 }, 6124.35),
      ),
    );
    expect(estimate).toMatchObject({
      status: 'no_market',
      problems: ['85,000P only 0.01/0.03 on book'],
    });
  });

  it('waits for books, reports book errors and venues without depth', () => {
    expect(estimateClose(group(), null)).toEqual({ status: 'unavailable', reason: 'order books off' });
    expect(estimateClose(group(), closeNow())).toEqual({ status: 'loading' });

    const loading = quote(LONG_85, 'sell', { filled: 0, vwap: null }, null, {
      status: 'book_unavailable',
      unavailableReason: 'loading',
    });
    const short = quote(SHORT_88, 'buy', { filled: 0.03, vwap: 6300 }, 6124.35);
    expect(estimateClose(group(), closeNow(loading, short))).toEqual({ status: 'loading' });

    const rejected = { ...loading, unavailableReason: 'rejected' as const };
    expect(estimateClose(group(), closeNow(rejected, short))).toEqual({
      status: 'unavailable',
      reason: 'Thalex refused the book',
    });

    const deribit = { ...loading, status: 'unsupported_venue' as const, venue: 'deribit' as const };
    expect(estimateClose(group(), closeNow(deribit, short))).toEqual({
      status: 'unavailable',
      reason: 'held on deribit',
    });
  });

  it('marks the estimate stale when any leg comes from a stale book', () => {
    const estimate = estimateClose(
      group(),
      closeNow(
        quote(LONG_85, 'sell', { filled: 0.03, vwap: 3115 }, 3263.47, { stale: true }),
        quote(SHORT_88, 'buy', { filled: 0.03, vwap: 6300 }, 6124.35),
      ),
    );
    expect(estimate).toMatchObject({ status: 'ok', stale: true });
  });

  it('leaves slippage out when a leg has no mark or mid', () => {
    const estimate = estimateClose(
      group(),
      closeNow(
        quote(LONG_85, 'sell', { filled: 0.03, vwap: 3115 }, null),
        quote(SHORT_88, 'buy', { filled: 0.03, vwap: 6300 }, 6124.35),
      ),
    );
    expect(estimate).toMatchObject({ status: 'ok', markCashUsd: null, slippageUsd: null });
  });
});
