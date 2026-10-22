import { defineMessages, useT } from '@lib/i18n';
import type { InstrumentCandleInterval, InstrumentCandleRange } from '@oggregator/protocol';
import { useEffect, useMemo, useState } from 'react';
import TradfiChartPanel, { type TradfiChartPanelData } from './TradfiChartPanel';
import styles from './TradfiPopoutChartPage.module.css';
import { parseTradfiPopoutParams } from './tradfi-chart-popout';

const INTERVALS: InstrumentCandleInterval[] = ['5m', '15m', '1h', '1d'];
const RANGES: InstrumentCandleRange[] = ['1d', '7d', '30d', 'max'];

const messages = defineMessages(
  { invalidUrl: 'Invalid TradFi popout URL.' },
  { invalidUrl: 'URL de ventana emergente TradFi no válida.' },
);

export default function TradfiPopoutChartPage() {
  const t = useT(messages);
  const initial = useMemo(() => parseTradfiPopoutParams(window.location.search), []);
  const [data, setData] = useState<TradfiChartPanelData | null>(() =>
    initial
      ? {
          underlying: initial.underlying,
          expiry: initial.expiry,
          strike: initial.strike,
          type: initial.type,
          interval: (INTERVALS as string[]).includes(initial.interval)
            ? (initial.interval as InstrumentCandleInterval)
            : '1h',
          range: (RANGES as string[]).includes(initial.range)
            ? (initial.range as InstrumentCandleRange)
            : '7d',
          chartMode: initial.mode,
        }
      : null,
  );

  useEffect(() => {
    if (data)
      document.title = `${data.underlying} ${data.strike} ${data.type.toUpperCase()} · TradFi`;
  }, [data]);

  if (!data) return <div className={styles.error}>{t('invalidUrl')}</div>;
  return (
    <div className={styles.root}>
      <TradfiChartPanel
        data={data}
        onPatch={(patch) => setData((d) => (d ? { ...d, ...patch } : d))}
      />
    </div>
  );
}
