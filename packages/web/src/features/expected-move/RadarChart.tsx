import type {
  ExpectedMoveAsset,
  ExpectedMoveSession,
  ExpectedStraddleResponse,
} from '@oggregator/protocol';
import { fmtIv, fmtPrice, fmtUsdPrice } from '@lib/format';
import { useT } from '@lib/i18n';
import { useEffect, useId, useRef, useState } from 'react';
import type { ExpectedMoveSettings } from './settings';
import {
  coneBounds,
  radarRatios,
  straddleLevels,
  type RadarCone,
  type RadarEvent,
  type RadarPoint,
} from './radar-model';
import { radarMessages } from './radar-i18n';
import styles from './ExpectedMovePanel.module.css';

export function radarTime(time: number, date = false) {
  const iso = new Date(time).toISOString();
  return date ? iso.slice(5, 10) : iso.slice(11, 16);
}

export function radarPrice(value: number | null | undefined, asset: ExpectedMoveAsset) {
  return asset === 'SPX' ? fmtPrice(value) : fmtUsdPrice(value);
}

interface RadarChartProps {
  asset: ExpectedMoveAsset;
  session: ExpectedMoveSession;
  points: RadarPoint[];
  primary: RadarCone | null;
  live: RadarCone | null;
  quote: ExpectedStraddleResponse | null;
  settings: ExpectedMoveSettings;
  events: RadarEvent[];
  replay: boolean;
  fresh: boolean;
}

export default function RadarChart({
  asset,
  session,
  points,
  primary,
  live,
  quote,
  settings,
  events,
  replay,
  fresh,
}: RadarChartProps) {
  const t = useT(radarMessages);
  const root = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 380 });
  const [inspected, setInspected] = useState<number | null>(null);
  const clip = useId().replaceAll(':', '');
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) setSize({ width: rect.width, height: rect.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const last = points.at(-1) ?? { time: session.startMs, price: session.open, gap: false };
  const end = settings.horizon === 'expiry' && primary ? primary.end : session.endMs;
  const start = session.startMs;
  const left = 12;
  const right = Math.max(left + 80, size.width - (size.width < 430 ? 78 : 96));
  const top = 26;
  const bottom = Math.max(top + 80, size.height - 34);
  const x = (time: number) => left + ((time - start) / Math.max(1, end - start)) * (right - left);
  const levels =
    quote && quote.expiryTs != null && quote.expiryTs <= end && settings.showStraddle
      ? straddleLevels(quote)
      : [];
  const sampled = (cone: RadarCone, level: number) =>
    Array.from({ length: 97 }, (_, i) => {
      const time = cone.start + ((cone.end - cone.start) * i) / 96;
      return { time, bounds: coneBounds(cone, time, level)! };
    });
  const coneSamples = primary ? sampled(primary, settings.showTwoSigma ? 2 : 1) : [];
  const liveSamples = live ? sampled(live, 1) : [];
  const values = [
    session.open,
    ...points.map((p) => p.price),
    ...coneSamples.flatMap((p) => p.bounds),
    ...liveSamples.flatMap((p) => p.bounds),
    ...levels.flatMap((l) => [l.lower, l.upper]),
    ...(levels.length && quote?.strike ? [quote.strike] : []),
  ].filter((v) => Number.isFinite(v) && v > 0);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = Math.max((max - min) * 0.14, session.open * 0.001);
  const floor = Math.max(0, min - pad);
  const ceiling = max + pad;
  const y = (price: number) => bottom - ((price - floor) / (ceiling - floor)) * (bottom - top);
  const basePrice = settings.horizon === 'expiry' && primary ? primary.center : session.open;
  const sigmaWidth =
    primary?.shape === 'lognormal'
      ? primary.scale * Math.sqrt((primary.end - primary.start) / primary.clockMs)
      : null;
  const unit = (value: number) =>
    settings.chartUnit === 'percent'
      ? `${((value / basePrice - 1) * 100).toFixed(2)}%`
      : settings.chartUnit === 'sigma'
        ? sigmaWidth != null && sigmaWidth > 0
          ? `${(Math.log(value / basePrice) / sigmaWidth).toFixed(2)}σ`
          : session.expectedUsd != null && session.expectedUsd > 0
            ? `${((value - session.open) / session.expectedUsd).toFixed(2)}σ`
            : '—'
        : radarPrice(value, asset);
  const area = (cone: RadarCone, level: number) => {
    const samples = sampled(cone, level);
    return [
      ...samples.map((p) => `${x(p.time)},${y(p.bounds[1])}`),
      ...[...samples].reverse().map((p) => `${x(p.time)},${y(p.bounds[0])}`),
    ].join(' ');
  };
  const boundary = (cone: RadarCone, side: 0 | 1) =>
    sampled(cone, 1)
      .map((p, i) => `${i ? 'L' : 'M'}${x(p.time)},${y(p.bounds[side])}`)
      .join(' ');
  const trail = points
    .map((p, i) => `${i === 0 || p.gap ? 'M' : 'L'}${x(p.time)},${y(p.price)}`)
    .join(' ');
  const active =
    inspected == null ? null : (points[Math.min(inspected, points.length - 1)] ?? null);
  const activeRatios = active ? radarRatios(session, active) : null;
  const inspectAt = (clientX: number) => {
    const rect = root.current?.getBoundingClientRect();
    if (!rect || !points.length) return;
    const time = start + ((clientX - rect.left - left) / (right - left)) * (end - start);
    let index = 0;
    for (let i = 1; i < points.length; i++)
      if (Math.abs(points[i]!.time - time) < Math.abs(points[index]!.time - time)) index = i;
    setInspected(index);
  };
  const terminal = primary ? coneBounds(primary, primary.end) : null;
  const labels: Array<{
    key: string;
    price: number;
    label: string;
    className: string | undefined;
    position?: number;
  }> = [
    ...(terminal
      ? [
          { key: 'upper', price: terminal[1], label: '+1σ', className: styles.coneLabel },
          { key: 'lower', price: terminal[0], label: '−1σ', className: styles.coneLabel },
        ]
      : []),
    { key: 'open', price: session.open, label: t('open'), className: styles.openLabel },
    { key: 'spot', price: last.price, label: t('spot'), className: styles.spotLabel },
  ].sort((a, b) => y(a.price) - y(b.price));
  let previous = top - 30;
  for (const label of labels) {
    label.position = Math.max(top + 6, previous + 28, y(label.price));
    previous = label.position;
  }
  const overflow = Math.max(0, previous - bottom);
  for (const label of labels) label.position = label.position! - overflow;
  const tickCount = size.width < 430 ? 3 : 5;

  return (
    <>
      <div className={styles.chart} ref={root}>
        <svg
          width={size.width}
          height={size.height}
          role="img"
          aria-label={t('chart')}
          tabIndex={0}
          onPointerMove={(e) => inspectAt(e.clientX)}
          onPointerDown={(e) => inspectAt(e.clientX)}
          onPointerLeave={(e) => {
            if (e.pointerType === 'mouse') setInspected(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setInspected(null);
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
              e.preventDefault();
              e.stopPropagation();
              setInspected(
                Math.max(
                  0,
                  Math.min(
                    points.length - 1,
                    (inspected ?? points.length - 1) + (e.key === 'ArrowLeft' ? -1 : 1),
                  ),
                ),
              );
            }
          }}
        >
          <title>{t('chart')}</title>
          <desc>
            {t('inspectHint')} {t('coneNote')}
          </desc>
          <defs>
            <clipPath id={clip}>
              <rect x={left} y={top} width={right - left} height={bottom - top} />
            </clipPath>
          </defs>
          {Array.from({ length: 5 }, (_, i) => {
            const value = floor + ((ceiling - floor) * i) / 4;
            return (
              <g key={i}>
                <line
                  className={styles.gridLine}
                  x1={left}
                  x2={right}
                  y1={y(value)}
                  y2={y(value)}
                />
                <text className={styles.axisText} x={right - 5} y={y(value) - 5} textAnchor="end">
                  {unit(value)}
                </text>
              </g>
            );
          })}
          <g clipPath={`url(#${clip})`}>
            {last.time < end && (
              <rect
                className={styles.future}
                x={x(last.time)}
                y={top}
                width={Math.max(0, right - x(last.time))}
                height={bottom - top}
              />
            )}
            {primary && settings.showTwoSigma && (
              <polygon className={styles.outerCone} points={area(primary, 2)} />
            )}
            {primary && (
              <>
                <polygon className={styles.innerCone} points={area(primary, 1)} />
                <path className={styles.coneEdge} d={boundary(primary, 0)} />
                <path className={styles.coneEdge} d={boundary(primary, 1)} />
              </>
            )}
            <line
              className={styles.openLine}
              x1={left}
              x2={right}
              y1={y(session.open)}
              y2={y(session.open)}
            />
            {live && (
              <>
                <path className={styles.liveEdge} d={boundary(live, 0)} />
                <path className={styles.liveEdge} d={boundary(live, 1)} />
              </>
            )}
            {levels.length > 0 && quote && quote.expiryTs != null && (
              <>
                {levels.flatMap((level) =>
                  ([level.lower, level.upper] as const).map((value, i) => (
                    <g key={`${level.kind}-${i}`}>
                      <line
                        className={level.kind === 'buy' ? styles.buyLine : styles.sellLine}
                        x1={x(quote.quoteAsOfMs ?? last.time)}
                        x2={x(quote.expiryTs!)}
                        y1={y(value)}
                        y2={y(value)}
                      />
                      <circle
                        className={level.kind === 'buy' ? styles.buyDot : styles.sellDot}
                        cx={x(quote.expiryTs!)}
                        cy={y(value)}
                        r={3}
                      />
                    </g>
                  )),
                )}
                {quote.strike != null && (
                  <line
                    className={styles.strikeLine}
                    x1={x(quote.quoteAsOfMs ?? last.time)}
                    x2={x(quote.expiryTs)}
                    y1={y(quote.strike)}
                    y2={y(quote.strike)}
                  />
                )}
              </>
            )}
            <path className={styles.spotPath} d={trail} />
            {points
              .filter((p) => p.gap)
              .map((p) => (
                <circle
                  key={p.time}
                  className={styles.gapDot}
                  cx={x(p.time)}
                  cy={y(p.price)}
                  r={2}
                />
              ))}
            {events.map((event) => (
              <circle
                key={`${event.time}-${event.level}`}
                className={event.kind === 'cross' ? styles.eventCross : styles.eventReturn}
                cx={x(event.time)}
                cy={y(event.price)}
                r={event.level === 2 ? 5 : 3.5}
              />
            ))}
            <line
              className={styles.nowLine}
              x1={x(last.time)}
              x2={x(last.time)}
              y1={top}
              y2={bottom}
            />
            <circle className={styles.currentDot} cx={x(last.time)} cy={y(last.price)} r={4} />
            {active && (
              <>
                <line
                  className={styles.inspectLine}
                  x1={x(active.time)}
                  x2={x(active.time)}
                  y1={top}
                  y2={bottom}
                />
                <circle
                  className={styles.currentDot}
                  cx={x(active.time)}
                  cy={y(active.price)}
                  r={5}
                />
              </>
            )}
          </g>
          <text
            className={styles.chartTag}
            x={Math.max(left, Math.min(right - 70, x(last.time) + 6))}
            y={15}
          >
            {replay ? t('replay') : fresh ? t('now') : t('observed')}
          </text>
          {labels.map((label) => (
            <g className={label.className} key={label.key}>
              <path
                className={styles.labelLeader}
                d={`M${right},${y(label.price)} L${right + 5},${label.position}`}
              />
              <text x={right + 9} y={label.position! - 3}>
                {unit(label.price)}
              </text>
              <text className={styles.labelCaption} x={right + 9} y={label.position! + 10}>
                {label.label}
              </text>
            </g>
          ))}
          {Array.from({ length: tickCount }, (_, i) => {
            const time = start + ((end - start) * i) / (tickCount - 1);
            return (
              <text
                key={i}
                className={styles.axisText}
                x={x(time)}
                y={size.height - 10}
                textAnchor={i === 0 ? 'start' : i === tickCount - 1 ? 'end' : 'middle'}
              >
                {radarTime(time, end - start > 2 * 86_400_000)}
              </text>
            );
          })}
          <text className={styles.axisText} x={right + 9} y={size.height - 10}>
            UTC
          </text>
        </svg>
        {active && activeRatios && (
          <div className={styles.inspection} aria-live="polite">
            <span>
              {radarTime(active.time)} UTC · {t('selected')}
            </span>
            <strong>{radarPrice(active.price, asset)}</strong>
            <span>
              {t('dailyMove')}: {activeRatios.daily?.toFixed(2) ?? '—'}× · {t('pace')}:{' '}
              {activeRatios.pace?.toFixed(2) ?? '—'}×
            </span>
            <span>IV {fmtIv(session.openingIv)}</span>
          </div>
        )}
      </div>
      {events.length > 0 && (
        <div className={styles.events} aria-label={t('events')}>
          {events.slice(-6).map((event) => (
            <button
              key={`${event.time}-${event.level}`}
              className={styles.eventChip}
              onClick={() => setInspected(points.findIndex((p) => p.time === event.time))}
            >
              <span className={event.kind === 'cross' ? styles.amber : styles.teal}>
                {event.kind === 'cross' ? '↗' : '↘'}
              </span>
              {t(event.kind === 'cross' ? 'cross' : 'reentry', { level: event.level })}
              <small>{radarTime(event.time)}</small>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
