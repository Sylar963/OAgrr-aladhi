import { useT } from '@lib/i18n';
import type { IvHistoryPoint, IvTenor } from '@shared/enriched';
import { type PointerEvent, useState } from 'react';
import { skewMessages, surfaceMessages } from './i18n';
import { type IvHistoryWindow, useSkewSpotHistory } from './queries';
import styles from './SkewPriceChart.module.css';
import { chartPath, chartRange, nearestPoint } from './skew-price';
import { useMeasuredWidth } from './use-measured-width';

const SKEW_COLOR = '#50d2c1';
const PRICE_COLOR = '#f59e0b';
const HEIGHT = 236;
const LEFT = 48;
const RIGHT = 64;
const TOP = 14;
const BOTTOM = 26;
const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});
const date = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const timestamp = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const vol = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(2)}`;

interface Props {
  underlying: string;
  tenor: IvTenor;
  window: IvHistoryWindow;
  series: IvHistoryPoint[];
  loading: boolean;
  failed: boolean;
  retry: () => void;
}

export default function SkewPriceChart({
  underlying,
  tenor,
  window,
  series,
  loading,
  failed,
  retry,
}: Props) {
  const t = useT(skewMessages);
  const ts = useT(surfaceMessages);
  const price = useSkewSpotHistory(underlying, window);
  const [ref, measuredWidth] = useMeasuredWidth<HTMLDivElement>(640);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const width = Math.max(240, measuredWidth);
  const tickCount = width < 400 ? 3 : 5;
  const end = Math.floor(Date.now() / 1000);
  const start = end - (window === '90d' ? 90 : 30) * 86_400;
  const skew = series
    .map((point) => ({
      time: point.ts / 1000,
      value: point.rr25d == null ? null : point.rr25d * 100,
    }))
    .filter((point) => point.time >= start && point.time <= end);
  const spot = (price.data?.candles ?? [])
    .map((candle) => ({
      time: candle.timestamp / 1000 + 3600,
      value: candle.close,
    }))
    .filter((point) => point.time >= start && point.time <= end);
  const skewRange = chartRange(skew);
  const spotRange = chartRange(spot);
  const toX = (time: number) => LEFT + ((time - start) / (end - start)) * (width - LEFT - RIGHT);
  const scale = (range: [number, number], value: number) =>
    TOP + ((range[1] - value) / (range[1] - range[0])) * (HEIGHT - TOP - BOTTOM);
  const skewGap = window === '90d' ? 10_800 : 2700;
  const hoverSkew = hoverTime == null ? null : nearestPoint(skew, hoverTime, skewGap / 2);
  const hoverSpot = hoverTime == null ? null : nearestPoint(spot, hoverTime, 1800);
  const latestSkew = [...skew]
    .reverse()
    .find((point) => point.value != null && Number.isFinite(point.value));
  const latestSpot = spot.at(-1);
  const shownSkew = hoverTime == null ? latestSkew : hoverSkew;
  const shownSpot = hoverTime == null ? latestSpot : hoverSpot;
  const move = (event: PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * width;
    setHoverTime(
      Math.max(start, Math.min(end, start + ((x - LEFT) / (width - LEFT - RIGHT)) * (end - start))),
    );
  };

  return (
    <div className={styles.wrap} ref={ref}>
      <div className={styles.legend}>
        <span style={{ color: SKEW_COLOR }}>{t('skewLegend', { tenor })}</span>
        <span style={{ color: PRICE_COLOR }}>{t('priceLegend', { underlying })}</span>
      </div>
      <div className={styles.readout} aria-live="off">
        <span style={{ color: SKEW_COLOR }}>
          RR{' '}
          {shownSkew?.value != null
            ? `${vol(shownSkew.value)} vp · ${timestamp.format(shownSkew.time * 1000)}`
            : '—'}
        </span>
        <span style={{ color: PRICE_COLOR }}>
          {shownSpot?.value != null
            ? `${usd.format(shownSpot.value)} · ${timestamp.format(shownSpot.time * 1000)}`
            : '—'}
        </span>
      </div>
      {(loading || price.isLoading || failed || price.isError) && (
        <div className={styles.status} role="status">
          {failed ? t('skewFailed') : loading ? ts('loading') : null}
          {price.isError ? t('priceFailed') : price.isLoading ? t('priceLoading') : null}
          {(failed || price.isError) && (
            <button
              type="button"
              onClick={() => {
                if (failed) retry();
                if (price.isError) void price.refetch();
              }}
            >
              {ts('retry')}
            </button>
          )}
        </div>
      )}
      {!skewRange && !loading && !failed && (
        <div className={styles.status}>{ts('insufficientHistory')}</div>
      )}
      <svg
        viewBox={`0 0 ${width} ${HEIGHT}`}
        width="100%"
        height={HEIGHT}
        role="img"
        aria-label={t('priceAria', { underlying })}
        onPointerDown={move}
        onPointerMove={move}
        onPointerLeave={(event) => {
          if (event.pointerType === 'mouse') setHoverTime(null);
        }}
      >
        {[0, 0.5, 1].map((fraction) => {
          const y = TOP + fraction * (HEIGHT - TOP - BOTTOM);
          return (
            <g key={fraction}>
              <line x1={LEFT} x2={width - RIGHT} y1={y} y2={y} className={styles.grid} />
              {skewRange && (
                <text x={LEFT - 8} y={y + 3} textAnchor="end" fill={SKEW_COLOR}>
                  {vol(skewRange[1] - fraction * (skewRange[1] - skewRange[0]))}
                </text>
              )}
              {spotRange && (
                <text x={width - RIGHT + 8} y={y + 3} fill={PRICE_COLOR}>
                  {usd.format(spotRange[1] - fraction * (spotRange[1] - spotRange[0]))}
                </text>
              )}
            </g>
          );
        })}
        {skewRange && skewRange[0] < 0 && skewRange[1] > 0 && (
          <line
            x1={LEFT}
            x2={width - RIGHT}
            y1={scale(skewRange, 0)}
            y2={scale(skewRange, 0)}
            className={styles.zero}
          />
        )}
        {spotRange && (
          <path
            d={chartPath(spot, toX, (value) => scale(spotRange, value), 5400)}
            fill="none"
            stroke={PRICE_COLOR}
            strokeWidth="1.3"
            strokeOpacity="0.8"
          />
        )}
        {skewRange && (
          <path
            d={chartPath(skew, toX, (value) => scale(skewRange, value), skewGap)}
            fill="none"
            stroke={SKEW_COLOR}
            strokeWidth="1.7"
          />
        )}
        {Array.from({ length: tickCount }, (_, index) => {
          const time = start + ((end - start) * index) / (tickCount - 1);
          return (
            <text
              key={index}
              x={toX(time)}
              y={HEIGHT - 5}
              textAnchor={index === 0 ? 'start' : index === tickCount - 1 ? 'end' : 'middle'}
              className={styles.axis}
            >
              {date.format(time * 1000)}
            </text>
          );
        })}
        {hoverTime != null && (
          <line
            x1={toX(hoverTime)}
            x2={toX(hoverTime)}
            y1={TOP}
            y2={HEIGHT - BOTTOM}
            className={styles.crosshair}
          />
        )}
        {hoverSkew?.value != null && skewRange && (
          <circle
            cx={toX(hoverSkew.time)}
            cy={scale(skewRange, hoverSkew.value)}
            r="3"
            fill={SKEW_COLOR}
          />
        )}
        {hoverSpot?.value != null && spotRange && (
          <circle
            cx={toX(hoverSpot.time)}
            cy={scale(spotRange, hoverSpot.value)}
            r="3"
            fill={PRICE_COLOR}
          />
        )}
      </svg>
      <div className={styles.caption}>{t('priceCaption')}</div>
    </div>
  );
}
