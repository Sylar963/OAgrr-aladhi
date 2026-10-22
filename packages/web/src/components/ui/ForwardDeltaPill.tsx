import { forwardDriftLevel, type ForwardLevel } from '@lib/colors';
import { fmtDelta } from '@lib/format';
import { defineMessages, useT } from '@lib/i18n';

import styles from './ForwardDeltaPill.module.css';

interface ForwardDeltaPillProps {
  delta: number | null;
  atmStrike: number | null;
  withinConsensusBand: boolean | null;
}

const messages = defineMessages(
  {
    green: 'Clean forward — any price divergence on this venue is real MM skew',
    amber: 'Moderate forward drift — interpret skew with caveat',
    red: 'Forward drift dominates — cheap/expensive prices on this venue are likely fake skew',
    muted: 'Insufficient data to compute forward divergence',
    withinBand:
      'Consensus forward lies inside this venue’s bid/ask no-arbitrage band — the apparent drift is explainable by spread, not a real dislocation',
  } satisfies Record<ForwardLevel | 'withinBand', string>,
  {
    green: 'Forward limpio — cualquier divergencia de precio en este exchange es skew real del MM',
    amber: 'Deriva moderada del forward — interpreta el skew con cautela',
    red: 'Domina la deriva del forward — los precios baratos/caros en este exchange probablemente son skew falso',
    muted: 'Datos insuficientes para calcular la divergencia del forward',
    withinBand:
      'El forward de consenso está dentro de la banda de no arbitraje bid/ask de este exchange — la deriva aparente se explica por el spread, no es una dislocación real',
  },
);

export default function ForwardDeltaPill({
  delta,
  atmStrike,
  withinConsensusBand,
}: ForwardDeltaPillProps) {
  const t = useT(messages);
  if (delta == null || atmStrike == null || atmStrike === 0) {
    return (
      <span className={styles.pill} data-level="muted" title={t('muted')}>
        –
      </span>
    );
  }

  const deltaBps = (delta / atmStrike) * 10_000;

  if (withinConsensusBand === true) {
    return (
      <span
        className={styles.pill}
        data-level="muted"
        data-explained="spread"
        title={`${t('withinBand')} (Δ=${fmtDelta(delta)}, ${deltaBps.toFixed(2)} bps)`}
      >
        {fmtDelta(delta)}
      </span>
    );
  }

  const level = forwardDriftLevel(deltaBps);

  return (
    <span
      className={styles.pill}
      data-level={level}
      title={`${t(level)} (Δ=${fmtDelta(delta)}, ${deltaBps.toFixed(2)} bps)`}
    >
      {fmtDelta(delta)}
    </span>
  );
}
