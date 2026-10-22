import { useAccountSession } from '@components/auth/AccountSessionProvider';
import type { ThesisDirection, ThesisGateLeg, ThesisView } from '@oggregator/protocol';
import { useState } from 'react';

import FlipBanner from './FlipBanner';
import { gateStructureKey, useThesisFor, useThesisGate } from './hooks';
import ThesisCreateForm from './ThesisCreateForm';
import ThesisGatePanel from './ThesisGatePanel';
import ThesisStrip from './ThesisStrip';
import styles from './Thesis.module.css';

/** The structure's break-even on the side where a thesis in `direction` would be wrong. */
export function invalidationFromBreakevens(
  direction: ThesisDirection,
  breakevens: number[],
  spotUsd: number,
): number | null {
  if (!(spotUsd > 0)) return null;
  if (direction === 'bearish') {
    const above = breakevens.filter((be) => be > spotUsd);
    return above.length > 0 ? Math.min(...above) : null;
  }
  const below = breakevens.filter((be) => be < spotUsd);
  return below.length > 0 ? Math.max(...below) : null;
}

export function useThesisGateState(underlying: string, legs: ThesisGateLeg[] | null) {
  const thesis = useThesisFor(underlying);
  const gate = useThesisGate(underlying, legs);
  const data = gate.data;
  const gated = data?.decision === 'gate' && data.view != null;
  return {
    thesis,
    gate: data ?? null,
    gated,
    structureKey: gateStructureKey(legs),
    invalidationLevel: thesis.active?.thesis.level ?? null,
  };
}

export type ThesisGateState = ReturnType<typeof useThesisGateState>;

interface ThesisSectionProps {
  underlying: string;
  state: ThesisGateState;
  expiryOptions: string[];
  breakevens: number[];
  spotUsd: number;
  nearestExpiry: string | null;
}

export default function ThesisSection({
  underlying,
  state,
  expiryOptions,
  breakevens,
  spotUsd,
  nearestExpiry,
}: ThesisSectionProps) {
  const session = useAccountSession();
  const [creating, setCreating] = useState(false);
  if (session.status !== 'ready') return null;

  const { thesis, gate, gated, structureKey } = state;
  const proposedDirection = gate?.proposed.classification;
  const direction: ThesisDirection =
    proposedDirection === 'bullish' || proposedDirection === 'bearish' ? proposedDirection : 'bearish';
  const level = invalidationFromBreakevens(direction, breakevens, spotUsd);
  const gateView: ThesisView | null = gated ? gate?.view ?? null : null;
  const flipDirection: ThesisDirection = gateView?.thesis.direction === 'bearish' ? 'bullish' : 'bearish';
  const flipLevel = invalidationFromBreakevens(flipDirection, breakevens, spotUsd);

  return (
    <div className={styles.section}>
      <FlipBanner underlying={underlying} />
      <ThesisStrip
        underlying={underlying}
        active={thesis.active}
        reversal={thesis.reversal}
        onSetThesis={() => setCreating(true)}
      />
      {creating && thesis.active == null && (
        <ThesisCreateForm
          underlying={underlying}
          expiryOptions={expiryOptions}
          spotUsd={spotUsd > 0 ? spotUsd : null}
          initial={{
            direction,
            horizonExpiry: nearestExpiry ?? expiryOptions[0] ?? '',
            level: level == null ? '' : String(Math.round(level)),
            confirmSec: 86400,
            reason: '',
          }}
          onClose={() => setCreating(false)}
        />
      )}
      {gate != null && gateView != null && (
        <ThesisGatePanel
          key={`${gateView.thesis.id}|${structureKey}`}
          gate={{ ...gate, view: gateView }}
          underlying={underlying}
          expiryOptions={expiryOptions}
          flipLevel={flipLevel == null ? '' : String(Math.round(flipLevel))}
        />
      )}
      {gate?.decision === 'unknown' && (thesis.active != null || thesis.reversal != null) && (
        <div className={styles.note}>
          Thesis check could not classify this structure ({gate.proposed.note ?? 'missing data'}).
        </div>
      )}
    </div>
  );
}
