import type { FlowAnalysis, FlowAnalysisLeg, FlowOiContext, FlowPositionAssessment } from '@oggregator/protocol';

export interface FlowIntervalTape {
  volume: number;
  count: number;
  targetPresent: boolean;
  coverage: FlowPositionAssessment['coverage'];
}

export function reconcileFlowPosition(
  leg: FlowAnalysisLeg,
  oi: FlowOiContext,
  tape: FlowIntervalTape,
): FlowPositionAssessment {
  const result: FlowPositionAssessment = {
    status: 'unavailable', action: null, basis: 'oi_reconciliation', quantity: leg.quantity,
    minOpening: null, minClosing: null, intervalVolume: tape.volume, otherVolume: null,
    tradeCount: tape.count, coverage: tape.coverage, reason: 'missing_oi',
  };
  if (oi.status === 'pending') return { ...result, status: 'pending', reason: 'waiting_for_oi' };
  if (oi.status !== 'bracketed' || oi.delta == null) return result;
  if (tape.coverage === 'gap' || tape.coverage === 'truncated' || tape.coverage === 'unavailable')
    return { ...result, status: 'incomplete', reason: 'tape_incomplete' };
  if (!tape.targetPresent)
    return { ...result, status: 'incomplete', reason: 'target_not_matched' };
  if (leg.expiry && oi.after && oi.after.timestamp >= Date.parse(`${leg.expiry}T08:00:00Z`))
    return { ...result, reason: 'expiry_window' };
  const { quantity: q } = leg;
  const delta = oi.delta;
  const tolerance = 1e-8 * Math.max(1, q, tape.volume);
  if (!Number.isFinite(tape.volume) || tape.volume < q - tolerance || Math.abs(delta) > tape.volume + tolerance)
    return { ...result, status: 'inconsistent', reason: 'oi_exceeds_tape' };
  const other = Math.max(0, tape.volume - q);
  // Other executions can explain at most their volume of OI change in either direction.
  const minOpening = Math.min(q, Math.max(0, delta - other));
  const minClosing = Math.min(q, Math.max(0, -delta - other));
  const bounds = { ...result, minOpening, minClosing, otherVolume: other };
  if (minOpening >= q - tolerance)
    return { ...bounds, status: 'inferred_open', action: leg.side === 'buy' ? 'buy_to_open' : 'sell_to_open', reason: 'all_volume_opening' };
  if (minClosing >= q - tolerance)
    return { ...bounds, status: 'inferred_close', action: leg.side === 'buy' ? 'buy_to_close' : 'sell_to_close', reason: 'all_volume_closing' };
  if (minOpening > tolerance)
    return { ...bounds, status: 'opening_component', reason: 'opening_lower_bound' };
  if (minClosing > tolerance)
    return { ...bounds, status: 'closing_component', reason: 'closing_lower_bound' };
  return {
    ...bounds, status: Math.abs(delta) <= tolerance ? 'offsetting' : 'ambiguous',
    reason: Math.abs(delta) <= tolerance ? 'no_net_oi_change' : 'other_trades_can_explain_oi',
  };
}

export function flowPositionEffect(legs: FlowAnalysisLeg[]): FlowAnalysis['positionEffect'] {
  if (legs.length === 0) return 'unknown';
  const statuses = legs.map((leg) => leg.position?.status);
  if (statuses.every((status) => status === 'inferred_open')) return 'inferred_open';
  if (statuses.every((status) => status === 'inferred_close')) return 'inferred_close';
  if (statuses.includes('inferred_open') && statuses.includes('inferred_close')) return 'mixed';
  if (statuses.some((status) => status && ['inferred_open', 'inferred_close', 'opening_component', 'closing_component'].includes(status))) return 'partial';
  return 'unknown';
}
