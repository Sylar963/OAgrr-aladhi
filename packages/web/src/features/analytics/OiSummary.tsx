import type { EnrichedChainResponse } from '@shared/enriched';
import { fmtUsdCompact } from '@lib/format';
import { useT } from '@lib/i18n';
import { computeSummary, NEAR_EXPIRY_DAYS } from './positioning-utils';
import { positioningMessages } from './i18n';
import styles from './Positioning.module.css';

interface OiSummaryProps {
  chains: EnrichedChainResponse[];
}

function fmtRatio(v: number | null): string {
  return v == null ? '–' : v.toFixed(2);
}

function fmtShare(v: number | null): string {
  return v == null ? '–' : `${(v * 100).toFixed(1)}%`;
}

function pcTone(v: number | null): 'put' | 'call' | undefined {
  if (v == null) return undefined;
  if (v > 1.3) return 'put';
  if (v < 0.7) return 'call';
  return undefined;
}

export default function OiSummary({ chains }: OiSummaryProps) {
  const t = useT(positioningMessages);
  const s = computeSummary(chains);

  const kpis: { id: string; label: string; value: string; note: string; tone?: string }[] = [
    {
      id: 'oi',
      label: t('kpiOpenInterest'),
      value: fmtUsdCompact(s.oiUsd),
      note: t('noteUsdNotional'),
    },
    {
      id: 'vol',
      label: t('kpiVolume24h'),
      value: fmtUsdCompact(s.volUsd),
      note: t('noteUsdNotional'),
    },
    {
      id: 'pcOi',
      label: t('kpiPcOi'),
      value: fmtRatio(s.pcOi),
      note: t('notePcHeld'),
      tone: pcTone(s.pcOi),
    },
    {
      id: 'pcVol',
      label: t('kpiPcVol'),
      value: fmtRatio(s.pcVol),
      note: t('notePcTraded'),
      tone: pcTone(s.pcVol),
    },
    {
      id: 'turnover',
      label: t('turnover'),
      value: fmtShare(s.turnover),
      note: t('noteTurnover'),
    },
    {
      id: 'near',
      label: t('kpiExpiring', { n: NEAR_EXPIRY_DAYS }),
      value: fmtShare(s.nearOiShare),
      note: t('noteRollsOff', { amount: fmtUsdCompact(s.nearOiUsd) }),
      tone: s.nearOiShare != null && s.nearOiShare >= 0.2 ? 'warn' : undefined,
    },
  ];

  return (
    <div className={styles.kpiStrip}>
      {kpis.map((k) => (
        <div key={k.id} className={styles.kpi}>
          <span className={styles.kpiLabel}>{k.label}</span>
          <span className={styles.kpiValue} data-tone={k.tone}>
            {k.value}
          </span>
          <span className={styles.kpiNote}>{k.note}</span>
        </div>
      ))}
    </div>
  );
}
