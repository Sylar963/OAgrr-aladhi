import type { ThesisGateCheckResponse } from '@oggregator/protocol';
import { useLocale, useT } from '@lib/i18n';

import { fmtExpiry, fmtUsdSigned, structureLabel } from './format';
import { thesisMessages } from './i18n';
import styles from './Thesis.module.css';

interface StructureSummaryProps {
  gate: ThesisGateCheckResponse;
  horizonExpiry: string;
}

export default function StructureSummary({ gate, horizonExpiry }: StructureSummaryProps) {
  const t = useT(thesisMessages);
  const locale = useLocale();
  const { proposed, held, combined } = gate;
  const showBook =
    held != null &&
    combined != null &&
    held.classification !== 'unknown' &&
    combined.classification !== 'unknown';

  return (
    <div className={styles.structureLine}>
      {t('structureUpDown', { up: fmtUsdSigned(proposed.upPnlUsd), down: fmtUsdSigned(proposed.downPnlUsd) })}
      {proposed.movePct != null && ` ${t('structureMove', { pct: proposed.movePct.toFixed(1) })}`}{' '}
      {t('structureBy', { date: fmtExpiry(horizonExpiry, locale) })} <strong>{structureLabel(proposed, locale)}</strong>.
      {gate.heldBookNote && <span className={styles.note}> {gate.heldBookNote}</span>}
      {showBook && (
        <span className={styles.note}>
          {' '}
          {t('bookEffect', { held: structureLabel(held, locale), combined: structureLabel(combined, locale) })}
        </span>
      )}
    </div>
  );
}
