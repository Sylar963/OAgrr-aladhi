import type {
  ThesisClassification,
  ThesisDirection,
  ThesisGateReason,
  ThesisStatus,
} from '@oggregator/protocol';

export interface GateDecisionInput {
  /** Direction of the active thesis, or null when none is active. */
  thesisDirection: ThesisDirection | null;
  status: ThesisStatus | null;
  /** Direction of a thesis ended early whose reversal cooldown is still running. */
  reversalDirection: ThesisDirection | null;
  target: ThesisClassification;
}

export interface GateDecision {
  decision: 'pass' | 'gate' | 'unknown';
  reason: ThesisGateReason;
}

export function oppositeDirection(direction: ThesisDirection): ThesisDirection {
  return direction === 'bullish' ? 'bearish' : 'bullish';
}

export function gateDecision(input: GateDecisionInput): GateDecision {
  const { thesisDirection, status, reversalDirection, target } = input;
  if (thesisDirection == null) {
    if (reversalDirection != null) {
      if (target === 'unknown') return { decision: 'unknown', reason: 'unknown' };
      if (target === oppositeDirection(reversalDirection)) {
        return { decision: 'gate', reason: 'reversal_cooldown' };
      }
    }
    return { decision: 'pass', reason: 'no_thesis' };
  }
  if (status === 'INVALIDATED') return { decision: 'pass', reason: 'rule_fired' };
  if (status === 'EXPIRED') return { decision: 'pass', reason: 'expired' };
  if (target === 'unknown') return { decision: 'unknown', reason: 'unknown' };
  if (target === thesisDirection) return { decision: 'pass', reason: 'same_direction' };
  if (target === 'neutral') return { decision: 'pass', reason: 'neutral' };
  return { decision: 'gate', reason: 'opposite' };
}
