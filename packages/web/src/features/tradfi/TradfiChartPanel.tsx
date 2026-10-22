import {
  AttributionSummary,
  InstrumentAttributionChart,
  InstrumentChart,
  type OptionRight,
} from '@features/chain';
import { defineMessages, useT } from '@lib/i18n';
import type { InstrumentCandleInterval, InstrumentCandleRange } from '@oggregator/protocol';
import styles from './TradfiChartPanel.module.css';
import { useTradfiAttribution } from './use-tradfi-attribution';
import { useTradfiCandles } from './use-tradfi-candles';

const INTERVALS: InstrumentCandleInterval[] = ['5m', '15m', '1h', '1d'];
const RANGES: InstrumentCandleRange[] = ['1d', '7d', '30d', 'max'];

const messages = defineMessages(
  {
    close: 'Close',
    price: 'Price',
    attribution: 'Attribution',
    loading: 'loading…',
    errorRetry: 'error — retry',
    noCandles: 'No candle history for this strike.',
    computing: 'computing attribution…',
    insufficient: 'insufficient option / underlying overlap for this strike + range',
  },
  {
    close: 'Cerrar',
    price: 'Precio',
    attribution: 'Atribución',
    loading: 'cargando…',
    errorRetry: 'error — reintentar',
    noCandles: 'Sin historial de velas para este strike.',
    computing: 'calculando atribución…',
    insufficient: 'superposición insuficiente entre opción y subyacente para este strike + rango',
  },
);

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
  const t = useT(messages);
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
          <button type="button" onClick={onClose} aria-label={t('close')}>
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
            {t('price')}
          </button>
          <button
            type="button"
            aria-pressed={chartMode === 'attribution'}
            data-active={chartMode === 'attribution' || undefined}
            onClick={() => onPatch({ chartMode: 'attribution' })}
          >
            {t('attribution')}
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
            {candles.isLoading && !candles.data && <div className={styles.empty}>{t('loading')}</div>}
            {candles.error && <div className={styles.empty}>{t('errorRetry')}</div>}
            {candles.data && candles.data.candles.length === 0 && (
              <div className={styles.empty}>{t('noCandles')}</div>
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
            {attribution.isLoading && <div className={styles.empty}>{t('computing')}</div>}
            {attribution.error && <div className={styles.empty}>{t('errorRetry')}</div>}
            {attribution.insufficientData && (
              <div className={styles.empty}>{t('insufficient')}</div>
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
