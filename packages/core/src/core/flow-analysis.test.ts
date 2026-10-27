import { describe, expect, it } from 'vitest';
import { analyzeFlowLegs, analyzeFlowTrade, flowExecutionGroup } from './flow-analysis.js';
import { parseTradeInstrument } from '../trade-persistence.js';
import type { TradeEvent } from '../runtime/trades/types.js';
import type { FlowAnalysisLeg } from '@oggregator/protocol';

function leg(instrument: string, side: 'buy' | 'sell', quantity = 1): FlowAnalysisLeg {
  return { instrument, side, quantity, ...parseTradeInstrument(instrument) };
}
const call = (strike: number, side: 'buy' | 'sell', quantity = 1) =>
  leg(`BTC-30OCT26-${strike}-C`, side, quantity);
const put = (strike: number, side: 'buy' | 'sell', quantity = 1) =>
  leg(`BTC-30OCT26-${strike}-P`, side, quantity);

describe('exchange-linked flow structures', () => {
  it.each([
    [[call(80000, 'buy'), put(80000, 'buy')], 'STRADDLE'],
    [[put(70000, 'sell'), call(90000, 'sell')], 'STRANGLE'],
    [[put(80000, 'buy'), put(70000, 'sell')], 'PUT_SPREAD'],
    [[call(80000, 'buy'), call(90000, 'sell', 2)], 'CALL_RATIO'],
    [[call(70000, 'buy'), call(80000, 'sell', 2), call(90000, 'buy')], 'CALL_BUTTERFLY'],
    [
      [put(60000, 'buy'), put(70000, 'sell'), call(90000, 'sell'), call(100000, 'buy')],
      'IRON_CONDOR',
    ],
    [
      [put(70000, 'buy'), put(80000, 'sell'), call(80000, 'sell'), call(90000, 'buy')],
      'IRON_BUTTERFLY',
    ],
    [[put(70000, 'buy'), call(90000, 'sell')], 'RISK_REVERSAL'],
    [[call(80000, 'sell'), leg('BTC-27NOV26-80000-C', 'buy')], 'CALL_CALENDAR_SPREAD'],
    [[call(80000, 'sell'), leg('BTC-27NOV26-90000-C', 'buy')], 'CALL_DIAGONAL'],
  ] as const)('recognizes validated legs without claiming an opening', (legs, kind) => {
    const result = analyzeFlowLegs([...legs], 'block:1', { groupComplete: true });
    expect(result.structure).toBe(kind);
    expect(result.positionEffect).toBe('unknown');
    expect(result.completeness).toBe('complete');
  });

  it('does not infer a spread from unlinked prints', () => {
    expect(analyzeFlowLegs([call(80000, 'buy'), call(90000, 'sell')], null).structure).toBe(
      'UNLINKED',
    );
    expect(
      flowExecutionGroup({ comboId: 'BTC-CS-30OCT26-80000_90000', rfqId: 'request' }),
    ).toBeNull();
  });

  it('keeps a missing hedge or third leg partial', () => {
    const result = analyzeFlowLegs([call(80000, 'buy'), call(90000, 'sell')], 'block:1', {
      expectedLegCount: 3,
    });
    expect(result).toMatchObject({
      structure: 'PARTIAL',
      completeness: 'partial',
      executionSide: 'mixed',
      positionEffect: 'unknown',
    });
  });

  it('does not turn malformed ratios or mixed currencies into standard structures', () => {
    expect(
      analyzeFlowLegs([call(70000, 'buy'), call(80000, 'sell'), call(90000, 'buy')], 'x').structure,
    ).toBe('CUSTOM');
    expect(
      analyzeFlowLegs([call(80000, 'buy'), leg('ETH-30OCT26-80000-P', 'buy')], 'x').structure,
    ).toBe('CUSTOM');
    expect(
      analyzeFlowLegs([call(80000, 'buy'), leg('BTC-31FEB26-90000-C', 'sell')], 'x').issues,
    ).toContain('unsupported_instrument');
  });

  it('preserves opposing executions on the same instrument', () => {
    const result = analyzeFlowLegs([call(80000, 'buy'), call(80000, 'sell')], 'x');
    expect(result.executionSide).toBe('mixed');
    expect(result.legs.map((item) => item.side)).toEqual(['buy', 'sell']);
    expect(result.issues).toContain('opposing_fills_same_instrument');
  });

  it('parses fractional Derive strikes', () => {
    expect(leg('HYPE-20261113-92_5-C', 'buy')).toMatchObject({
      strike: 92.5,
      optionType: 'call',
      expiry: '2026-11-13',
    });
  });

  it('uses execution IDs and deduplicates repeated prints when reconstructing a combo', () => {
    const base: TradeEvent = {
      venue: 'deribit',
      tradeId: '1',
      instrument: 'BTC-30OCT26-80000-C',
      underlying: 'BTC',
      side: 'buy',
      price: 0.01,
      size: 50,
      iv: null,
      markPrice: null,
      indexPrice: null,
      isBlock: true,
      timestamp: 1_000,
      exchangeEvidence: { blockTradeId: '1', expectedLegCount: 2 },
    };
    const other: TradeEvent = { ...base, tradeId: '2', instrument: 'BTC-30OCT26-80000-P' };
    const unrelated = { ...other, tradeId: '3', exchangeEvidence: { blockTradeId: '2' } };
    const result = analyzeFlowTrade(base, [base, other, other, unrelated]);
    expect(result).toMatchObject({
      structure: 'STRADDLE',
      completeness: 'complete',
      positionEffect: 'unknown',
    });
    expect(result.legs.map((item) => item.quantity)).toEqual([50, 50]);
  });
});
