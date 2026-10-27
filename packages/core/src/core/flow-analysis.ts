import type { ExchangeTradeEvidence, FlowAnalysis, FlowAnalysisLeg } from '@oggregator/protocol';
import { getVenueContractMultiplier, parseTradeInstrument } from '../trade-persistence.js';
import type { BlockTradeEvent } from '../runtime/block-trades/types.js';
import type { TradeEvent } from '../runtime/trades/types.js';

export function flowExecutionGroup(evidence?: ExchangeTradeEvidence): string | null {
  if (evidence?.blockTradeId) return `block:${evidence.blockTradeId}`;
  if (evidence?.comboTradeId) return `combo:${evidence.comboTradeId}`;
  return null;
}

export function analyzeFlowTrade(trade: TradeEvent, peers: TradeEvent[] = [trade]): FlowAnalysis {
  const groupId = flowExecutionGroup(trade.exchangeEvidence);
  const linked = groupId == null ? [trade] : peers.filter((peer) =>
    peer.venue === trade.venue && peer.underlying === trade.underlying
      && flowExecutionGroup(peer.exchangeEvidence) === groupId,
  );
  const unique = [...new Map([trade, ...linked].map((leg) => [
    `${leg.instrument}:${leg.tradeId ?? `${leg.timestamp}:${leg.side}:${leg.size}:${leg.price}`}`, leg,
  ])).values()];
  return analyzeFlowLegs(unique.map((leg) => ({
    instrument: leg.instrument,
    side: leg.side,
    quantity: leg.size * getVenueContractMultiplier(leg.venue, leg.underlying),
    ...parseTradeInstrument(leg.instrument),
  })), groupId, trade.exchangeEvidence, trade.venue === 'deribit' || trade.venue === 'bybit' ? 'taker' : 'reported');
}

export function analyzeBlockTrade(trade: BlockTradeEvent): FlowAnalysis {
  return analyzeFlowLegs(trade.legs.map((leg) => ({
    instrument: leg.instrument,
    side: leg.direction,
    quantity: leg.size * leg.ratio * getVenueContractMultiplier(trade.venue, trade.underlying),
    ...parseTradeInstrument(leg.instrument),
  })), trade.tradeId, trade.exchangeEvidence, 'legs');
}

export function analyzeFlowLegs(
  input: FlowAnalysisLeg[],
  groupId: string | null,
  evidence?: ExchangeTradeEvidence,
  sideBasis: FlowAnalysis['sideBasis'] = 'reported',
): FlowAnalysis {
  const issues: string[] = [];
  const valid = input.filter((leg) => Number.isFinite(leg.quantity) && leg.quantity > 0);
  if (valid.length !== input.length) issues.push('invalid_quantity');
  const legs = [...new Map(valid.map((leg) => [`${leg.instrument}:${leg.side}`, { ...leg, quantity: 0 }])).values()];
  for (const leg of valid) {
    const aggregate = legs.find((item) => item.instrument === leg.instrument && item.side === leg.side)!;
    if (legs.some((item) => item.instrument === leg.instrument && item.side !== leg.side)) {
      issues.push('opposing_fills_same_instrument');
    }
    aggregate.quantity += leg.quantity;
  }
  const families = new Set(legs.map((leg) => `${leg.instrument.split('-')[0]}:${leg.instrument.match(/-(USDC|USDT)$/)?.[1] ?? ''}`));
  if (families.size > 1) issues.push('mixed_instrument_families');
  const completeness = evidence?.groupComplete === false
    || (evidence?.expectedLegCount != null && evidence.expectedLegCount !== input.length)
    ? 'partial'
    : evidence?.groupComplete === true || evidence?.expectedLegCount === input.length
      ? 'complete' : 'unknown';
  if (completeness === 'partial') issues.push('incomplete_group');
  if (legs.some((leg) => leg.expiry == null || leg.strike == null || leg.optionType == null)) {
    issues.push('unsupported_instrument');
  }
  const sides = new Set(legs.map((leg) => leg.side));
  let structure = legs.length === 1 && issues.length === 0 ? (legs[0]!.optionType?.toUpperCase() ?? 'UNKNOWN') : 'CUSTOM';
  if (groupId != null && issues.length === 0) structure = classify(legs);
  if (completeness === 'partial') structure = 'PARTIAL';
  if (groupId == null && legs.length > 1) structure = 'UNLINKED';
  return {
    structure,
    linkage: groupId == null ? 'unlinked' : 'exchange',
    completeness,
    groupId,
    executionSide: sides.size === 1 ? legs[0]!.side : 'mixed',
    sideBasis: legs.length > 1 ? 'legs' : sideBasis,
    positionEffect: 'unknown',
    legs,
    issues: [...new Set(issues)],
  };
}

function equal(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-8 * Math.max(1, Math.abs(a), Math.abs(b));
}

function classify(legs: FlowAnalysisLeg[]): string {
  if (legs.length === 0) return 'UNKNOWN';
  if (legs.length === 1) return legs[0]!.optionType?.toUpperCase() ?? 'UNKNOWN';
  const ordered = [...legs].sort((a, b) => a.strike! - b.strike!);
  const sameExpiry = legs.every((leg) => leg.expiry === legs[0]!.expiry);
  const sameType = legs.every((leg) => leg.optionType === legs[0]!.optionType);
  const sameQuantity = legs.every((leg) => equal(leg.quantity, legs[0]!.quantity));
  const prefix = legs[0]!.optionType === 'call' ? 'CALL' : 'PUT';
  if (legs.length === 2) {
    const [a, b] = ordered as [FlowAnalysisLeg, FlowAnalysisLeg];
    const opposite = a.side !== b.side;
    if (sameType && opposite) {
      if (sameExpiry && a.strike !== b.strike) return `${prefix}_${sameQuantity ? 'SPREAD' : 'RATIO'}`;
      if (!sameExpiry && sameQuantity) return `${prefix}_${a.strike === b.strike ? 'CALENDAR_SPREAD' : 'DIAGONAL'}`;
    }
    if (!sameType && sameExpiry && sameQuantity) {
      if (!opposite && a.strike === b.strike) return 'STRADDLE';
      const put = legs.find((leg) => leg.optionType === 'put')!;
      const call = legs.find((leg) => leg.optionType === 'call')!;
      if (put.strike! < call.strike!) return opposite ? 'RISK_REVERSAL' : 'STRANGLE';
    }
  }
  if (legs.length === 3 && sameType && sameExpiry) {
    const [a, b, c] = ordered as [FlowAnalysisLeg, FlowAnalysisLeg, FlowAnalysisLeg];
    if (a.strike! < b.strike! && b.strike! < c.strike!
      && a.side === c.side && a.side !== b.side && equal(a.quantity, c.quantity)
      && equal(b.quantity, 2 * a.quantity)
      && equal(b.strike! - a.strike!, c.strike! - b.strike!)) return `${prefix}_BUTTERFLY`;
  }
  if (legs.length === 4 && sameExpiry && sameQuantity) {
    const puts = ordered.filter((leg) => leg.optionType === 'put');
    const calls = ordered.filter((leg) => leg.optionType === 'call');
    if (puts.length === 2 && calls.length === 2) {
      const [p0, p1] = puts as [FlowAnalysisLeg, FlowAnalysisLeg];
      const [c0, c1] = calls as [FlowAnalysisLeg, FlowAnalysisLeg];
      if (p0.strike! < p1.strike! && p1.strike! <= c0.strike! && c0.strike! < c1.strike!
        && p0.side === c1.side && p1.side === c0.side && p0.side !== p1.side) {
        return p1.strike === c0.strike ? 'IRON_BUTTERFLY' : 'IRON_CONDOR';
      }
    }
  }
  return 'CUSTOM';
}
