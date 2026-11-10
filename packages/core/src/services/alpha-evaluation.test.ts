import { describe, expect, it } from 'vitest';
import {
  AlphaEvaluationRequestSchema,
  AlphaEvaluationResponseSchema,
  type AlphaEvaluationRequest,
} from '@oggregator/protocol';
import { cdf, price76 } from '../feeds/thalex/bs-solver.js';
import { evaluateAlphaTrade, type AlphaEvaluationMarket } from './alpha-evaluation.js';
import type { SpotCandle } from './spot-candles.js';

const NOW = Date.UTC(2026, 10, 10, 12);
const DAY = 86_400_000;
const ID = '9ace5752-f0dc-4d47-b76b-620b5970d5f4';
const empty: AlphaEvaluationMarket = {
  candles: [],
  ivHistory: null,
  baselineIv: { '7d': [], '30d': [] },
  regime: null,
};

function request(): AlphaEvaluationRequest {
  return {
    candidate: {
      strategy: 'long-call',
      underlying: 'BTC',
      expiryTs: NOW + 30 * DAY,
      spot: 100,
      atmIv: 0.4,
      holdingQuantity: 0,
      entryFee: 0,
      costReserve: 0,
      lossBudget: 100,
      legs: [
        {
          venue: 'thalex',
          instrument: 'call',
          right: 'call',
          side: 'buy',
          strike: 100,
          quantity: 1,
          price: 5,
          fee: 0,
          availableQuantity: 10,
          minQuantity: 0.1,
          quantityStep: 0.1,
          quotedAt: NOW,
          quoteMode: 'live',
          markIv: 0.4,
          inverse: false,
          settlement: 'USD',
        },
      ],
    },
    scenario: { meanReturnPct: 0, annualVol: 0.4, meanUncertaintyPct: 5 },
    thesis: 'Explicit test scenario',
    invalidation: 'Below the stated floor',
  };
}

function run(input = request(), market = empty) {
  const parsed = AlphaEvaluationRequestSchema.parse(input);
  return AlphaEvaluationResponseSchema.parse(
    evaluateAlphaTrade(parsed, market, { nowMs: NOW, id: ID }),
  );
}

function history(): SpotCandle[] {
  return Array.from({ length: 200 }, (_, index) => ({
    timestamp: NOW - (201 - index) * DAY,
    open: 100,
    high: 110,
    low: 90,
    close: 100 * Math.exp((index % 2 ? 1 : -1) * (index > 185 ? 0.03 : 0.01)),
  }));
}

describe('Alpha evaluation', () => {
  it('uses independent user assumptions and known costs rather than claiming a market edge', () => {
    const input = request();
    input.candidate.legs[0]!.price = price76(100, 100, 0.4, 30 / 365, 'call');
    input.candidate.entryFee = 0.25;
    input.candidate.legs[0]!.fee = 0.25;
    input.candidate.costReserve = 0.5;
    const result = run(input);
    expect(result.scenario!.expectedPnl).toBeCloseTo(-0.75, 8);
    expect(result.evidence).toBe('unvalidated');
    expect(result.alignment).toBe('flat-thesis');
    expect(result.scenario!.lowerMeanExpectedPnl).toBeLessThan(result.scenario!.expectedPnl);
    expect(result.scenario!.upperMeanExpectedPnl).toBeGreaterThan(result.scenario!.expectedPnl);
  });

  it('keeps probability mass at the long-option maximum loss in the tail average', () => {
    const result = run();
    expect(result.payoff.maxExpiryLoss).toBe(5);
    expect(result.scenario!.pnl05).toBe(-5);
    expect(result.scenario!.expectedShortfall95).toBeCloseTo(-5, 8);
    expect(result.scenario!.probabilityOfProfit).toBeGreaterThan(0);
    expect(result.scenario!.probabilityOfProfit).toBeLessThan(0.5);
  });

  it('gives equal terminal distributions to equivalent call-debit and put-credit verticals', () => {
    const call = request();
    call.candidate.strategy = 'call-debit';
    call.candidate.legs[0] = { ...call.candidate.legs[0]!, strike: 90, price: 15 };
    call.candidate.legs.push({ ...call.candidate.legs[0]!, side: 'sell', strike: 110, price: 3 });
    const put = structuredClone(call);
    put.candidate.strategy = 'put-credit';
    put.candidate.legs = [
      { ...put.candidate.legs[0]!, right: 'put', side: 'buy', strike: 90, price: 3 },
      { ...put.candidate.legs[1]!, right: 'put', side: 'sell', strike: 110, price: 11 },
    ];
    const a = run(call);
    const b = run(put);
    expect(a.payoff.maxExpiryLoss).toBe(12);
    expect(b.payoff.maxExpiryLoss).toBe(12);
    expect(a.payoff.stressPoints).toEqual(b.payoff.stressPoints);
    expect(a.scenario!.expectedPnl).toBeCloseTo(b.scenario!.expectedPnl, 8);
    expect(a.scenario!.probabilityOfProfit).toBeCloseTo(b.scenario!.probabilityOfProfit, 8);
    expect(a.scenario!.expectedShortfall95).toBeCloseTo(b.scenario!.expectedShortfall95, 8);
  });

  it('separates bearish alignment from bullish alignment at the same volatility', () => {
    const input = request();
    input.scenario!.meanReturnPct = -10;
    expect(run(input).alignment).toBe('conflicts');
    input.candidate.strategy = 'long-put';
    input.candidate.legs[0]!.right = 'put';
    expect(run(input).alignment).toBe('aligned');
    input.scenario = null;
    expect(run(input).alignment).toBe('not-specified');
    expect(run(input).scenario).toBeNull();
  });

  it('accounts for uncovered holdings and does not confuse insurance with speculation', () => {
    const input = request();
    input.candidate.strategy = 'protective-put';
    input.candidate.holdingQuantity = 2;
    input.candidate.legs[0] = { ...input.candidate.legs[0]!, right: 'put', strike: 90 };
    const result = run(input);
    expect(result.alignment).toBe('insurance');
    expect(result.payoff.protection!.coverageRatio).toBe(0.5);
    expect(result.payoff.maxExpiryLoss).toBe(115);
    expect(result.execution.issues).toContain('over-budget');
    input.candidate.holdingQuantity = 1;
    input.candidate.legs[0]!.quantity = 3;
    expect(run(input).payoff.maxExpiryLoss).toBe(25);
  });

  it('withholds net figures when any fee or the reserve is unknown', () => {
    const input = request();
    input.candidate.legs[0]!.fee = null;
    expect(run(input).scenario).toBeNull();
    expect(run(input).payoff.netEntryCash).toBeNull();
    expect(run(input).execution.status).toBe('incomplete');
    input.candidate.legs[0]!.fee = 0;
    input.candidate.costReserve = null;
    expect(run(input).payoff.maxExpiryLoss).toBeNull();
  });

  it('integrates a continuous downside tail for a partially insured holding', () => {
    const input = request();
    input.candidate.strategy = 'protective-put';
    input.candidate.holdingQuantity = 2;
    input.candidate.lossBudget = 200;
    input.candidate.legs[0] = { ...input.candidate.legs[0]!, right: 'put', strike: 90 };
    const result = run(input).scenario!;
    const deviation = 0.4 * Math.sqrt(30 / 365);
    const quantile = -1.6448536269514729;
    expect(result.pnl05).toBeCloseTo(
      100 * Math.exp(-0.5 * deviation ** 2 + deviation * quantile) - 115,
      3,
    );
    expect(result.expectedShortfall95).toBeCloseTo(
      (100 * cdf(quantile - deviation)) / 0.05 - 115,
      3,
    );
  });

  it('checks actual quote age, displayed size, quantity rules and settlement support', () => {
    const input = request();
    input.candidate.legs[0]!.quotedAt = NOW - 31_000;
    input.candidate.legs[0]!.availableQuantity = 0.5;
    input.candidate.legs[0]!.quantityStep = 0.3;
    expect(run(input).execution.issues).toEqual(
      expect.arrayContaining(['stale-quote', 'insufficient-size', 'invalid-quantity']),
    );
    input.candidate.legs[0]!.inverse = true;
    expect(run(input).scenario).toBeNull();
    expect(run(input).execution.issues).toContain('inverse-settlement');
  });

  it('supports a deterministic user scenario without inventing a volatility floor', () => {
    const input = request();
    input.scenario = { meanReturnPct: 10, annualVol: 0, meanUncertaintyPct: 0 };
    const result = run(input).scenario!;
    expect(result.expectedPnl).toBeCloseTo(5, 8);
    expect(result.probabilityOfProfit).toBe(1);
    expect(result.expectedShortfall95).toBeCloseTo(5, 8);
  });

  it('does not mistake a recently received delayed quote for a current executable quote', () => {
    const input = request();
    input.candidate.legs[0]!.quoteMode = 'delayed';
    const result = run(input);
    expect(result.execution.status).toBe('blocked');
    expect(result.execution.issues).toContain('delayed-feed');
    input.candidate.legs[0]!.quoteMode = 'unknown';
    expect(run(input).execution.status).toBe('incomplete');
  });

  it('uses the actual horizon and ignores forming candles and stale/gapped history', () => {
    const market = { ...empty, candles: history() };
    const input = request();
    const result30 = run(input, market);
    expect(result30.pricing.forecastVol).not.toBeNull();
    input.candidate.expiryTs = NOW + 3 * DAY;
    const result3 = run(input, market);
    expect(result3.pricing.forecastVol).not.toBe(result30.pricing.forecastVol);
    market.candles.push({ timestamp: NOW, close: 1_000_000, high: 1_000_000, low: 1, open: 1 });
    expect(run(input, market).pricing.forecastVol).toBe(result3.pricing.forecastVol);
    market.candles.splice(-3, 1);
    expect(run(input, market).pricing.forecastVol).toBeNull();
    input.candidate.expiryTs = NOW + 91 * DAY;
    expect(run(input, market).pricing.forecastSupported).toBe(false);
    expect(run(input, market).pricing.forecastVol).toBeNull();
  });

  it('rejects mismatched structures and invalid scenario ranges at the I/O boundary', () => {
    const input = request();
    input.candidate.strategy = 'put-credit';
    expect(AlphaEvaluationRequestSchema.safeParse(input).success).toBe(false);
    input.candidate.strategy = 'long-call';
    input.scenario!.meanReturnPct = -95;
    input.scenario!.meanUncertaintyPct = 10;
    expect(AlphaEvaluationRequestSchema.safeParse(input).success).toBe(false);
  });

  it('requires exactly matched vertical quantities before reporting bounded expiry risk', () => {
    const input = request();
    input.candidate.strategy = 'call-credit';
    input.candidate.legs[0] = { ...input.candidate.legs[0]!, strike: 110, price: 2 };
    input.candidate.legs.push({
      ...input.candidate.legs[0]!,
      side: 'sell',
      strike: 100,
      price: 5,
      quantity: 1 + 1e-10,
    });
    expect(AlphaEvaluationRequestSchema.safeParse(input).success).toBe(false);
  });
});
