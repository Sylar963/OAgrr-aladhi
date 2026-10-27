import { describe, expect, it } from 'vitest';
import type { FlowAnalysisLeg, FlowOiContext } from '@oggregator/protocol';
import { flowPositionEffect, reconcileFlowPosition } from './flow-position.js';

const leg: FlowAnalysisLeg = { instrument: 'BTC-30OCT26-83000-C', side: 'sell', quantity: 0.2, expiry: '2026-10-30', strike: 83000, optionType: 'call' };
function context(delta: number): FlowOiContext {
  return { instrument: leg.instrument, status: 'bracketed', before: { timestamp: 1793060978016, openInterest: 1196.8 }, after: { timestamp: 1793061879772, openInterest: 1196.8 + delta }, delta, intervalMs: 901756, timing: 'sampled', tradeCoverage: 'recorded' };
}
const tape = { volume: 0.2, count: 1, targetPresent: true, coverage: 'recorded' as const };

describe('OI and tape position reconciliation', () => {
  it('reconstructs the screenshot sell as inferred sell to open', () => {
    expect(reconcileFlowPosition(leg, context(1197 - 1196.8), tape)).toMatchObject({ status: 'inferred_open', action: 'sell_to_open', minClosing: 0, otherVolume: 0 });
  });
  it.each(['buy', 'sell'] as const)('maps %s closing and opening without confusing execution side', (side) => {
    expect(reconcileFlowPosition({ ...leg, side }, context(0.2), tape).action).toBe(`${side}_to_open`);
    expect(reconcileFlowPosition({ ...leg, side }, context(-0.2), tape).action).toBe(`${side}_to_close`);
  });
  it('subtracts all other volume before attributing an opening component', () => {
    const result = reconcileFlowPosition({ ...leg, quantity: 50 }, context(40), { ...tape, volume: 80, count: 3 });
    expect(result).toMatchObject({ status: 'opening_component', action: null, minOpening: 10, minClosing: 0, otherVolume: 30 });
  });
  it('does not convert positive OI into BTO when other trades explain the whole increase', () => {
    expect(reconcileFlowPosition(leg, context(10), { ...tape, volume: 20, count: 4 })).toMatchObject({ status: 'ambiguous', action: null, minOpening: 0 });
  });
  it('does not claim a side opens or closes from unchanged OI', () => {
    expect(reconcileFlowPosition(leg, context(0), tape)).toMatchObject({ status: 'offsetting', action: null });
  });
  it('rejects mismatched units, missing target executions, gaps and truncated tape', () => {
    expect(reconcileFlowPosition(leg, context(2), tape).status).toBe('inconsistent');
    expect(reconcileFlowPosition(leg, context(0.2), { ...tape, targetPresent: false }).status).toBe('incomplete');
    for (const coverage of ['gap', 'truncated', 'unavailable'] as const)
      expect(reconcileFlowPosition(leg, context(0.2), { ...tape, coverage }).action).toBeNull();
  });
  it('does not attribute expiry settlement to traded closing volume', () => {
    const oi = context(-0.2);
    oi.after!.timestamp = Date.parse('2026-10-30T08:00:00Z');
    expect(reconcileFlowPosition(leg, oi, tape)).toMatchObject({ status: 'unavailable', reason: 'expiry_window' });
  });
  it('respects quantity lower bounds across every small integer opening / closing mixture', () => {
    for (let q = 1; q <= 4; q++) for (let r = 0; r <= 4; r++) {
      for (let opening = 0; opening <= q; opening++) for (let closing = 0; closing <= q - opening; closing++) {
        for (let otherDelta = -r; otherDelta <= r; otherDelta++) {
          const result = reconcileFlowPosition({ ...leg, quantity: q }, context(opening - closing + otherDelta), { ...tape, volume: q + r });
          expect(result.minOpening!).toBeLessThanOrEqual(opening);
          expect(result.minClosing!).toBeLessThanOrEqual(closing);
          if (result.status === 'inferred_open') expect(opening).toBe(q);
          if (result.status === 'inferred_close') expect(closing).toBe(q);
        }
      }
    }
  });
  it('aggregates a roll as mixed without dropping individual leg results', () => {
    const open = { ...leg, position: reconcileFlowPosition(leg, context(0.2), tape) };
    const close = { ...leg, position: reconcileFlowPosition(leg, context(-0.2), tape) };
    expect(flowPositionEffect([open, close])).toBe('mixed');
    expect(flowPositionEffect([open, leg])).toBe('partial');
  });
});
