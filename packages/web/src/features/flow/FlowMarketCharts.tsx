import { fmtIv } from '@lib/format';
import { defineMessages, useT } from '@lib/i18n';
import type {
  FlowStrikeMapIvPoint,
  FlowStrikeMapPoint,
} from '@oggregator/protocol';
import { useMemo, type KeyboardEvent } from 'react';
import type { HistoricalPriceCandle } from './chart-queries';
import { formatMoney, type OptionFilter, type StrikeFlowProfile } from './flow-map-model';
import type { HistoryRange } from './queries';
import styles from './FlowChartsView.module.css';

const messages = defineMessages(
  {
    underlyingPrice: 'Underlying price · perpetual proxy',
    proxyDetail: 'Candle source is a venue perpetual, not the options index.',
    flowVolume: 'Recorded option flow · bubble size = total notional',
    noCandles: 'No underlying candles for this range',
    buy: 'Buy',
    sell: 'Sell',
    calls: 'Calls',
    puts: 'Puts',
    trades: '{count} trades',
    notional: '{value} notional',
    strikeFlow: 'Signed notional by strike',
    call: 'Call',
    put: 'Put',
    noStrikeFlow: 'No strike flow in this expiry and range',
    ivSmile: 'Last traded IV by strike',
    ivDetail: 'Trade prints only · timestamps can differ by strike',
    ivCoverageLimited: 'Showing the 2,500 most-traded contracts',
    noIv: 'No IV prints for this expiry and range',
    ivPoint: '{type} {strike} · {iv} · {time}',
  },
  {
    underlyingPrice: 'Precio subyacente · proxy perpetuo',
    proxyDetail: 'La fuente de velas es un perpetuo del venue, no el índice de opciones.',
    flowVolume: 'Flujo de opciones registrado · tamaño = nocional total',
    noCandles: 'No hay velas del subyacente en este período',
    buy: 'Compra',
    sell: 'Venta',
    calls: 'Calls',
    puts: 'Puts',
    trades: '{count} trades',
    notional: '{value} nocional',
    strikeFlow: 'Nocional firmado por strike',
    call: 'Call',
    put: 'Put',
    noStrikeFlow: 'No hay flujo por strike para este vencimiento y período',
    ivSmile: 'Última IV negociada por strike',
    ivDetail: 'Solo prints de trades · las horas pueden variar por strike',
    ivCoverageLimited: 'Se muestran los 2.500 contratos más negociados',
    noIv: 'No hay prints de IV para este vencimiento y período',
    ivPoint: '{type} {strike} · {iv} · {time}',
  },
);

interface FlowSpotChartProps {
  candles: readonly HistoricalPriceCandle[];
  points: readonly FlowStrikeMapPoint[];
  range: HistoryRange;
  resolution: number;
  optionFilter: OptionFilter;
  selectedPoint: FlowStrikeMapPoint | null;
  onSelectPoint: (point: FlowStrikeMapPoint) => void;
}

const CHART = { width: 1_000, height: 430, left: 72, right: 24, top: 22, bottom: 54 };

export function FlowSpotChart({
  candles,
  points,
  range,
  resolution,
  optionFilter,
  selectedPoint,
  onSelectPoint,
}: FlowSpotChartProps) {
  const t = useT(messages);
  const start = range.start ? Date.parse(range.start) : 0;
  const end = range.end ? Date.parse(range.end) : start + resolution * 1000;
  const priceData = useMemo(
    () => candles
      .filter((candle) => candle.close > 0 && candle.timestamp >= start && candle.timestamp < end)
      .slice()
      .sort((left, right) => left.timestamp - right.timestamp),
    [candles, end, start],
  );
  const data = useMemo(() => {
    if (priceData.length === 0) return null;
    const rawLow = Math.min(...priceData.map((candle) => candle.low));
    const rawHigh = Math.max(...priceData.map((candle) => candle.high));
    const padding = Math.max((rawHigh - rawLow) * 0.06, rawHigh * 0.0005);
    const low = rawLow - padding;
    const high = rawHigh + padding;
    const x = (timestamp: number) =>
      CHART.left + ((timestamp - start) / Math.max(1, end - start)) * (CHART.width - CHART.left - CHART.right);
    const y = (price: number) =>
      CHART.top + ((high - price) / Math.max(1e-9, high - low)) * (CHART.height - CHART.top - CHART.bottom);
    const priceAt = (timestamp: number) => {
      let left = 0;
      let right = priceData.length - 1;
      while (left <= right) {
        const middle = (left + right) >> 1;
        const candle = priceData[middle];
        if (!candle) break;
        if (candle.timestamp < timestamp) left = middle + 1;
        else right = middle - 1;
      }
      const after = priceData[Math.min(left, priceData.length - 1)]!;
      const before = priceData[Math.max(0, left - 1)]!;
      const span = after.timestamp - before.timestamp;
      if (span <= 0) return after.close;
      const progress = Math.max(0, Math.min(1, (timestamp - before.timestamp) / span));
      return before.close + (after.close - before.close) * progress;
    };
    const linePath = priceData
      .map((candle, index) => `${index === 0 ? 'M' : 'L'}${x(candle.timestamp).toFixed(2)},${y(candle.close).toFixed(2)}`)
      .join(' ');
    const tickPrices = Array.from({ length: 5 }, (_, index) => high - ((high - low) * index) / 4);
    const tickTimes = Array.from({ length: 6 }, (_, index) => start + ((end - start) * index) / 5);
    return { x, y, low, high, priceAt, linePath, tickPrices, tickTimes };
  }, [end, priceData, start]);

  const visiblePoints = points.filter(
    (point) => optionFilter === 'all' || point.optionType === optionFilter,
  );
  const pointClusters = new Map<number, FlowStrikeMapPoint[]>();
  for (const point of visiblePoints) {
    const cluster = pointClusters.get(point.bucketTs) ?? [];
    cluster.push(point);
    pointClusters.set(point.bucketTs, cluster);
  }

  return (
    <section className={styles.chartPanel}>
      <div className={styles.panelHeading}>
        <div>
          <h3>{t('underlyingPrice')}</h3>
          <span>{t('proxyDetail')}</span>
        </div>
        <div className={styles.chartLegend}>
          <span><i data-side="buy" />{t('buy')}</span>
          <span><i data-side="sell" />{t('sell')}</span>
          <span title={t('calls')}><i data-option-type="call" />C</span>
          <span title={t('puts')}><i data-option-type="put" />P</span>
          <span className={styles.legendMeta}>{t('flowVolume')}</span>
        </div>
      </div>
      {data ? (
        <div className={styles.svgChartWrap}>
          <svg
            className={styles.svgChart}
            viewBox={`0 0 ${CHART.width} ${CHART.height}`}
            role="group"
            aria-label={t('underlyingPrice')}
            preserveAspectRatio="none"
          >
            {data.tickPrices.map((price, index) => {
              const y = data.y(price);
              return (
                <g key={`price-${index}`}>
                  <line x1={CHART.left} x2={CHART.width - CHART.right} y1={y} y2={y} className={styles.chartGrid} />
                  <text x={CHART.left - 10} y={y + 4} textAnchor="end" className={styles.chartAxisLabel}>
                    {Math.round(price).toLocaleString('en-US')}
                  </text>
                </g>
              );
            })}
            {data.tickTimes.map((timestamp, index) => {
              const x = data.x(timestamp);
              return (
                <g key={`time-${index}`}>
                  <line x1={x} x2={x} y1={CHART.top} y2={CHART.height - CHART.bottom} className={styles.chartGrid} />
                  <text x={x} y={CHART.height - 20} textAnchor="middle" className={styles.chartAxisLabel}>
                    {formatUtcTick(timestamp, end - start)}
                  </text>
                </g>
              );
            })}
            <path d={data.linePath} className={styles.spotLine} />
            {[...pointClusters.entries()].map(([bucketTs, cluster]) => {
              const centerTs = bucketTs + resolution * 500;
              const x = data.x(centerTs);
              const price = data.priceAt(centerTs);
              const y = data.y(price);
              const totalNotional = cluster.reduce((sum, point) => sum + point.notionalUsd, 0);
              const radius = 4 + Math.min(10, Math.log10(1 + totalNotional) * 1.2);
              const ordered = cluster.slice().sort((left, right) =>
                left.side.localeCompare(right.side) || left.optionType.localeCompare(right.optionType),
              );
              return ordered.map((point, index) => {
                const selected = samePoint(selectedPoint, point);
                const isSingle = ordered.length === 1;
                const slice = isSingle
                  ? null
                  : bubbleSlicePath(x, y, radius, -90 + (360 * index) / ordered.length, -90 + (360 * (index + 1)) / ordered.length);
                const common = {
                  className: styles.flowBubble,
                  'data-side': point.side,
                  'data-option-type': point.optionType,
                  'data-selected': selected || undefined,
                  role: 'button' as const,
                  tabIndex: 0,
                  'aria-pressed': selected,
                  'aria-label': `${point.optionType} ${point.side}: ${point.count} trades, ${formatMoney(point.notionalUsd)}, ${Math.round(price).toLocaleString('en-US')} at ${new Date(centerTs).toISOString()}`,
                  onClick: () => onSelectPoint(point),
                  onKeyDown: (event: KeyboardEvent<SVGElement>) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelectPoint(point);
                    }
                  },
                };
                const title = `${point.optionType.toUpperCase()} ${point.side.toUpperCase()} · ${point.count} trades · ${formatMoney(point.notionalUsd)} · ${Math.round(price).toLocaleString('en-US')} · ${new Date(centerTs).toISOString()}`;
                return isSingle ? (
                  <circle key={`${bucketTs}-${point.optionType}-${point.side}`} cx={x} cy={y} r={radius} {...common}>
                    <title>{title}</title>
                  </circle>
                ) : (
                  <path key={`${bucketTs}-${point.optionType}-${point.side}`} d={slice!} {...common}>
                    <title>{title}</title>
                  </path>
                );
              });
            })}
          </svg>
          <div className={styles.chartXAxis}>UTC</div>
        </div>
      ) : (
        <div className={styles.chartEmpty}>{t('noCandles')}</div>
      )}
    </section>
  );
}

interface FlowStrikeLadderProps {
  profile: readonly StrikeFlowProfile[];
  optionFilter: OptionFilter;
  spot: number | null;
  selectedInstrument: string | null;
  onSelectInstrument: (instrument: string) => void;
}

export function FlowStrikeLadder({
  profile,
  optionFilter,
  spot,
  selectedInstrument,
  onSelectInstrument,
}: FlowStrikeLadderProps) {
  const t = useT(messages);
  const rows = profile.filter((row) => {
    if (optionFilter === 'call') return row.callCount > 0;
    if (optionFilter === 'put') return row.putCount > 0;
    return row.callCount > 0 || row.putCount > 0;
  });
  const max = Math.max(
    1,
    ...rows.flatMap((row) => [row.callBuy + row.callSell, row.putBuy + row.putSell]),
  );

  return (
    <section className={`${styles.chartPanel} ${styles.strikePanel}`}>
      <div className={styles.panelHeading}>
        <div>
          <h3>{t('strikeFlow')}</h3>
          <span>{t('buy')} − {t('sell')} · choose a bar to inspect the contract</span>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className={styles.chartEmpty}>{t('noStrikeFlow')}</div>
      ) : (
        <div className={styles.strikeList}>
          {rows.slice().reverse().map((row) => (
            <div className={styles.strikeRow} key={row.strike} data-near-spot={spot != null && Math.abs(row.strike - spot) / spot < 0.02 || undefined}>
              <span className={styles.strikeValue}>{formatStrike(row.strike)}</span>
              {optionFilter !== 'put' ? (
                <StrikeSideButton
                  label={t('call')}
                  type="call"
                  buy={row.callBuy}
                  sell={row.callSell}
                  max={max}
                  instrument={row.callInstrument}
                  selected={row.callInstrument === selectedInstrument}
                  onSelect={onSelectInstrument}
                />
              ) : null}
              {optionFilter !== 'call' ? (
                <StrikeSideButton
                  label={t('put')}
                  type="put"
                  buy={row.putBuy}
                  sell={row.putSell}
                  max={max}
                  instrument={row.putInstrument}
                  selected={row.putInstrument === selectedInstrument}
                  onSelect={onSelectInstrument}
                />
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function StrikeSideButton({
  label,
  type,
  buy,
  sell,
  max,
  instrument,
  selected,
  onSelect,
}: {
  label: string;
  type: 'call' | 'put';
  buy: number;
  sell: number;
  max: number;
  instrument: string | null;
  selected: boolean;
  onSelect: (instrument: string) => void;
}) {
  const total = buy + sell;
  const width = Math.max(1, (total / max) * 100);
  const buyShare = total > 0 ? (buy / total) * 100 : 0;
  return (
    <button
      type="button"
      className={styles.strikeSide}
      data-type={type}
      data-selected={selected || undefined}
      disabled={instrument == null}
      onClick={() => instrument && onSelect(instrument)}
      aria-label={`${label} ${formatMoney(total)} at ${instrument ?? 'unavailable'}`}
      title={instrument ?? undefined}
    >
      <span className={styles.strikeType}>{type === 'call' ? 'C' : 'P'}</span>
      <span className={styles.strikeBarTrack}>
        <span className={styles.strikeBar} style={{ width: `${width}%` }}>
          <i data-side="buy" style={{ width: `${buyShare}%` }} />
          <i data-side="sell" style={{ width: `${100 - buyShare}%` }} />
        </span>
      </span>
      <span className={styles.strikeNet}>
        {buy >= sell ? '+' : '−'}{formatMoney(Math.abs(buy - sell))}
      </span>
    </button>
  );
}

interface FlowIvSmileProps {
  points: readonly FlowStrikeMapIvPoint[];
  optionFilter: OptionFilter;
  range: HistoryRange;
  selectedInstrument: string | null;
  coverageComplete: boolean;
}

export function FlowIvSmile({ points, optionFilter, range, selectedInstrument, coverageComplete }: FlowIvSmileProps) {
  const t = useT(messages);
  const visible = points.filter(
    (point) => point.iv != null && (optionFilter === 'all' || point.optionType === optionFilter),
  );
  const data = useMemo(() => {
    if (visible.length === 0) return null;
    const strikes = visible.map((point) => point.strike);
    const ivs = visible.map((point) => point.iv as number);
    const minStrike = Math.min(...strikes);
    const maxStrike = Math.max(...strikes);
    const minIv = Math.min(...ivs);
    const maxIv = Math.max(...ivs);
    const ivPadding = Math.max((maxIv - minIv) * 0.16, 0.02);
    const lowIv = Math.max(0, minIv - ivPadding);
    const highIv = maxIv + ivPadding;
    const x = (strike: number, type: 'call' | 'put') => {
      const base = 24 + ((strike - minStrike) / Math.max(1, maxStrike - minStrike)) * 312;
      return base + (type === 'call' ? -2 : 2);
    };
    const y = (iv: number) => 18 + ((highIv - iv) / Math.max(0.01, highIv - lowIv)) * 128;
    const pathFor = (type: 'call' | 'put') =>
      visible
        .filter((point) => point.optionType === type)
        .slice()
        .sort((left, right) => left.strike - right.strike)
        .map((point, index) => `${index === 0 ? 'M' : 'L'}${x(point.strike, type).toFixed(1)},${y(point.iv as number).toFixed(1)}`)
        .join(' ');
    return { x, y, minIv: lowIv, maxIv: highIv, callPath: pathFor('call'), putPath: pathFor('put') };
  }, [visible]);
  const windowEnd = range.end ? Date.parse(range.end) : Date.now();

  return (
    <section className={`${styles.chartPanel} ${styles.ivPanel}`}>
      <div className={styles.panelHeading}>
        <div>
          <h3>{t('ivSmile')}</h3>
          <span>{t('ivDetail')}</span>
          {!coverageComplete ? <span className={styles.dataWarning}>{t('ivCoverageLimited')}</span> : null}
        </div>
      </div>
      {data ? (
        <div className={styles.ivChartWrap}>
          <svg viewBox="0 0 360 180" className={styles.ivChart} role="img" aria-label={t('ivSmile')}>
            {[0, 1, 2].map((index) => {
              const value = data.maxIv - ((data.maxIv - data.minIv) * index) / 2;
              const y = data.y(value);
              return (
                <g key={index}>
                  <line x1="24" x2="336" y1={y} y2={y} className={styles.chartGrid} />
                  <text x="18" y={y + 3} textAnchor="end" className={styles.chartAxisLabel}>{fmtIv(value)}</text>
                </g>
              );
            })}
            <path d={data.callPath} className={styles.ivLine} data-type="call" />
            <path d={data.putPath} className={styles.ivLine} data-type="put" />
            {visible.map((point) => {
              const iv = point.iv;
              if (iv == null) return null;
              const x = data.x(point.strike, point.optionType);
              const y = data.y(iv);
              const stale = point.observedAt == null || windowEnd - point.observedAt > 24 * 60 * 60_000;
              return (
                <circle
                  key={point.instrument}
                  cx={x}
                  cy={y}
                  r={point.instrument === selectedInstrument ? 5 : 3.5}
                  className={styles.ivPoint}
                  data-type={point.optionType}
                  data-stale={stale || undefined}
                >
                  <title>
                    {`${point.optionType.toUpperCase()} ${formatStrike(point.strike)} · ${fmtIv(iv)} · ${point.observedAt == null ? 'time unavailable' : new Date(point.observedAt).toISOString()}`}
                  </title>
                </circle>
              );
            })}
          </svg>
          <div className={styles.ivAxisLabel}>Strike</div>
        </div>
      ) : (
        <div className={styles.chartEmpty}>{t('noIv')}</div>
      )}
    </section>
  );
}

function samePoint(left: FlowStrikeMapPoint | null, right: FlowStrikeMapPoint): boolean {
  return left?.bucketTs === right.bucketTs && left.side === right.side && left.optionType === right.optionType;
}

function bubbleSlicePath(cx: number, cy: number, radius: number, startDegrees: number, endDegrees: number): string {
  const start = (startDegrees * Math.PI) / 180;
  const end = (endDegrees * Math.PI) / 180;
  const x1 = cx + radius * Math.cos(start);
  const y1 = cy + radius * Math.sin(start);
  const x2 = cx + radius * Math.cos(end);
  const y2 = cy + radius * Math.sin(end);
  const largeArc = endDegrees - startDegrees > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`;
}

function formatUtcTick(timestamp: number, durationMs: number): string {
  const date = new Date(timestamp);
  if (durationMs > 86_400_000) {
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });
  }
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });
}

function formatStrike(strike: number): string {
  return `${(strike / 1_000).toLocaleString('en-US', { maximumFractionDigits: 1 })}k`;
}
