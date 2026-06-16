import {
  AttributionSummary,
  InstrumentAttributionChart,
  InstrumentChart,
  type OptionRight,
} from '@features/chain';
import type { InstrumentCandleInterval, InstrumentCandleRange } from '@oggregator/protocol';
import styles from './TradfiChartPanel.module.css';
import { useTradfiAttribution } from './use-tradfi-attribution';
import { useTradfiCandles } from './use-tradfi-candles';

const INTERVALS: InstrumentCandleInterval[] = ['5m', '15m', '1h', '1d'];
const RANGES: InstrumentCandleRange[] = ['1d', '7d', '30d', 'max'];

export interface TradfiChartPanelData {
  underlying: string;
  expiry: string;
  strike: number;
  type: OptionRight;
  interval: InstrumentCandleInterval;
  range: InstrumentCandleRange;
  chartMode: 'price' | 'attribution';
}

interface Props {
  data: TradfiChartPanelData;
  onPatch: (patch: Partial<TradfiChartPanelData>) => void;
  onClose?: () => void;
}

export default function TradfiChartPanel({ data, onPatch, onClose }: Props) {
  const { underlying, expiry, strike, type, interval, range, chartMode } = data;

  const candles = useTradfiCandles({
    underlying,
    expiry,
    strike,
    right: type,
    interval,
    range,
    enabled: chartMode === 'price',
  });
  const attribution = useTradfiAttribution({
    underlying,
    expiry,
    strike,
    right: type,
    interval,
    range,
    enabled: chartMode === 'attribution',
  });

  return (
    <div className={styles.panel}>
      <div className={styles.titlebar}>
        <span className={styles.title}>
          {underlying} {strike} {type.toUpperCase()} · {expiry}
          <span className={styles.cur}> · USD</span>
        </span>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        )}
      </div>

      <div className={styles.toolbar}>
        <div className={styles.modes}>
          <button
            type="button"
            aria-pressed={chartMode === 'price'}
            data-active={chartMode === 'price' || undefined}
            onClick={() => onPatch({ chartMode: 'price' })}
          >
            Price
          </button>
          <button
            type="button"
            aria-pressed={chartMode === 'attribution'}
            data-active={chartMode === 'attribution' || undefined}
            onClick={() => onPatch({ chartMode: 'attribution' })}
          >
            Attribution
          </button>
        </div>
        <div className={styles.group}>
          {INTERVALS.map((i) => (
            <button
              key={i}
              type="button"
              aria-pressed={interval === i}
              data-active={interval === i || undefined}
              onClick={() => onPatch({ interval: i })}
            >
              {i}
            </button>
          ))}
        </div>
        <div className={styles.group}>
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={range === r}
              data-active={range === r || undefined}
              onClick={() => onPatch({ range: r })}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.body}>
        {chartMode === 'price' ? (
          <>
            {candles.isLoading && !candles.data && <div className={styles.empty}>loading…</div>}
            {candles.error && <div className={styles.empty}>error — retry</div>}
            {candles.data && candles.data.candles.length === 0 && (
              <div className={styles.empty}>No candle history for this strike.</div>
            )}
            {candles.data && candles.data.candles.length > 0 && (
              <InstrumentChart
                candles={candles.data.candles}
                markLine={candles.data.markLine}
                overlays={{ mark: false, ma9: true, ma20: true }}
              />
            )}
          </>
        ) : (
          <>
            {attribution.isLoading && <div className={styles.empty}>computing attribution…</div>}
            {attribution.error && <div className={styles.empty}>error — retry</div>}
            {attribution.insufficientData && (
              <div className={styles.empty}>
                insufficient option / underlying overlap for this strike + range
              </div>
            )}
            {attribution.result && (
              <>
                <AttributionSummary summary={attribution.result.summary} priceCurrency="USD" />
                <InstrumentAttributionChart result={attribution.result} priceCurrency="USD" />
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
