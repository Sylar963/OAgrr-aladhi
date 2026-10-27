import { useAccountSession } from '@components/auth/AccountSessionProvider';
import { useLocale, useT } from '@lib/i18n';
import type { ThesisDirection, ThesisGateLeg, ThesisView } from '@oggregator/protocol';
import { useState } from 'react';

import FlipBanner from './FlipBanner';
import { classificationLabel, isVolShape } from './format';
import { gateStructureKey, useThesisFor, useThesisGate } from './hooks';
import { thesisMessages } from './i18n';
import ThesisCreateForm from './ThesisCreateForm';
import ThesisGatePanel from './ThesisGatePanel';
import StructureSummary from './StructureSummary';
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
  const t = useT(thesisMessages);
  const locale = useLocale();
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
  const activeThesis = thesis.active?.thesis ?? null;
  const volPass =
    gate?.decision === 'pass' &&
    gate.reason === 'neutral' &&
    activeThesis != null &&
    isVolShape(gate.combined?.classification === 'unknown' ? gate.proposed : gate.combined ?? gate.proposed);

  return (
    <div className={styles.section}>
      <FlipBanner underlying={underlying} />
      <ThesisStrip
        key={thesis.active?.thesis.id ?? underlying}
        underlying={underlying}
        active={thesis.active}
        reversal={thesis.reversal}
        recentlyEnded={thesis.recentlyEnded}
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
      {volPass && gate != null && activeThesis != null && (
        <div className={styles.volPass} role="note">
          <span>
            {t('volPass', {
              direction: classificationLabel(activeThesis.direction, locale),
              underlying,
            })}
          </span>
          <StructureSummary gate={gate} horizonExpiry={activeThesis.horizonExpiry} />
        </div>
      )}
      {gate?.decision === 'unknown' && (thesis.active != null || thesis.reversal != null) && (
        <div className={styles.note}>
          {t('cannotClassify', { note: gate.proposed.note ?? t('missingData') })}
        </div>
      )}
    </div>
  );
}
