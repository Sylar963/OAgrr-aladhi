import type { EnrichedChainResponse } from '@shared/enriched';
import { fmtUsdCompact } from '@lib/format';
import { computeSummary, NEAR_EXPIRY_DAYS } from './positioning-utils';
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
  const s = computeSummary(chains);

  const kpis: { label: string; value: string; note: string; tone?: string }[] = [
    { label: 'Open Interest', value: fmtUsdCompact(s.oiUsd), note: 'USD notional' },
    { label: '24h Volume', value: fmtUsdCompact(s.volUsd), note: 'USD notional' },
    {
      label: 'P/C · OI',
      value: fmtRatio(s.pcOi),
      note: 'put $ / call $ held',
      tone: pcTone(s.pcOi),
    },
    {
      label: 'P/C · 24h Vol',
      value: fmtRatio(s.pcVol),
      note: 'put $ / call $ traded',
      tone: pcTone(s.pcVol),
    },
    {
      label: 'Turnover',
      value: fmtShare(s.turnover),
      note: '24h volume / OI',
    },
    {
      label: `Expiring ≤${NEAR_EXPIRY_DAYS}d`,
      value: fmtShare(s.nearOiShare),
      note: `${fmtUsdCompact(s.nearOiUsd)} rolls off`,
      tone: s.nearOiShare != null && s.nearOiShare >= 0.2 ? 'warn' : undefined,
    },
  ];

  return (
    <div className={styles.kpiStrip}>
      {kpis.map((k) => (
        <div key={k.label} className={styles.kpi}>
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
