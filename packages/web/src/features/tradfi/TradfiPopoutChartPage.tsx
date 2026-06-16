import { useEffect, useMemo, useState } from 'react';
import type { InstrumentCandleInterval, InstrumentCandleRange } from '@oggregator/protocol';
import TradfiChartPanel, { type TradfiChartPanelData } from './TradfiChartPanel';
import { parseTradfiPopoutParams } from './tradfi-chart-popout';
import styles from './TradfiPopoutChartPage.module.css';

const INTERVALS: InstrumentCandleInterval[] = ['5m', '15m', '1h', '1d'];
const RANGES: InstrumentCandleRange[] = ['1d', '7d', '30d', 'max'];

export default function TradfiPopoutChartPage() {
  const initial = useMemo(() => parseTradfiPopoutParams(window.location.search), []);
  const [data, setData] = useState<TradfiChartPanelData | null>(() =>
    initial
      ? {
          underlying: initial.underlying,
          expiry: initial.expiry,
          strike: initial.strike,
          type: initial.type,
          interval: (INTERVALS as string[]).includes(initial.interval) ? (initial.interval as InstrumentCandleInterval) : '1h',
          range: (RANGES as string[]).includes(initial.range) ? (initial.range as InstrumentCandleRange) : '7d',
          chartMode: initial.mode,
        }
      : null,
  );

  useEffect(() => {
    if (data) document.title = `${data.underlying} ${data.strike} ${data.type.toUpperCase()} · TradFi`;
  }, [data]);

  if (!data) return <div className={styles.error}>Invalid TradFi popout URL.</div>;
  return (
    <div className={styles.root}>
      <TradfiChartPanel data={data} onPatch={(patch) => setData((d) => (d ? { ...d, ...patch } : d))} />
    </div>
  );
}
