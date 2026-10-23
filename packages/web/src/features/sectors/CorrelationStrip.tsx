import { InfoTip } from '@components/ui';
import { defineMessages, useT } from '@lib/i18n';
import type {
  CryptoSectorCorrelationPoint,
  CryptoSectorCorrelationResponse,
} from '@oggregator/protocol';
import { type PointerEvent, useState } from 'react';

import styles from './CorrelationStrip.module.css';
import { useSectorCorrelation } from './queries';

const messages = defineMessages(
  {
    title: 'Correlation',
    basis: '5m bars · {hours}h window',
    loading: 'Loading 5m candles…',
    unavailable: 'Correlation unavailable',
    correlated: 'Correlated',
    mixed: 'Mixed',
    dispersed: 'Dispersed',
    since: 'since {time}',
    sinceAll: 'all loaded history',
    sinceMark: 'regime start',
    rho: 'ρ sectors',
    exBtc: 'ρ ex-BTC',
    pc1: 'PC1',
    spread: 'spread',
    vsBaseline: 'vs {days}d',
    perHour: '/1h',
    now: 'now',
    legendRho: 'ρ sectors',
    legendExBtc: 'ex-BTC',
    legendGap: 'gap = BTC’s share',
    help: 'How to read this',
    helpRho:
      'ρ sectors: average correlation between the 11 equal-weight sector baskets over the last {hours}h of 5m returns. Correlated ≥ {hi}, dispersed ≤ {lo}.',
    helpExBtc:
      'ρ ex-BTC: the same after removing each sector’s BTC beta. The shaded gap between the two lines is the part of the co-movement BTC explains.',
    helpPc1: 'PC1: share of sector variance explained by one common factor.',
    helpSpread:
      'Spread: how far apart the sectors’ {hours}h moves are. Low spread + high ρ = herd move; high spread = rotation.',
    helpZ: 'σ: how unusual ρ is against the last {days} days.',
    readCorrelated: 'Sectors are moving as one block.',
    readMixed: 'Sectors partly move together.',
    readDispersed: 'Sectors are moving independently: rotation, not a market-wide move.',
    readRising: 'Correlation is rising fast ({d} in 1h).',
    readFalling: 'Correlation is falling fast ({d} in 1h).',
    readBtcDriven: 'Mostly BTC: with BTC removed ρ drops to {ex}.',
    readAltFactor: 'Not just BTC: sectors still move together with BTC removed ({ex}).',
    readDecouplingOne: '{names} is breaking away.',
    readDecouplingMany: '{names} are breaking away.',
  },
  {
    title: 'Correlación',
    basis: 'velas 5m · ventana {hours}h',
    loading: 'Cargando velas de 5m…',
    unavailable: 'Correlación no disponible',
    correlated: 'Correlacionado',
    mixed: 'Mixto',
    dispersed: 'Disperso',
    since: 'desde {time}',
    sinceAll: 'todo el historial cargado',
    sinceMark: 'inicio del régimen',
    rho: 'ρ sectores',
    exBtc: 'ρ sin BTC',
    pc1: 'PC1',
    spread: 'dispersión',
    vsBaseline: 'vs {days}d',
    perHour: '/1h',
    now: 'ahora',
    legendRho: 'ρ sectores',
    legendExBtc: 'sin BTC',
    legendGap: 'brecha = peso de BTC',
    help: 'Cómo leer esto',
    helpRho:
      'ρ sectores: correlación promedio entre las 11 canastas sectoriales (pesos iguales) en las últimas {hours}h de retornos de 5m. Correlacionado ≥ {hi}, disperso ≤ {lo}.',
    helpExBtc:
      'ρ sin BTC: lo mismo tras quitar la beta a BTC de cada sector. La brecha sombreada entre ambas líneas es la parte del co-movimiento que explica BTC.',
    helpPc1: 'PC1: proporción de la varianza sectorial explicada por un solo factor común.',
    helpSpread:
      'Dispersión: qué tan separados están los movimientos de {hours}h de los sectores. Baja dispersión + ρ alto = movimiento en manada; alta = rotación.',
    helpZ: 'σ: qué tan inusual es ρ frente a los últimos {days} días.',
    readCorrelated: 'Los sectores se mueven como un solo bloque.',
    readMixed: 'Los sectores se mueven juntos en parte.',
    readDispersed: 'Los sectores se mueven por separado: rotación, no un movimiento de todo el mercado.',
    readRising: 'La correlación sube rápido ({d} en 1h).',
    readFalling: 'La correlación cae rápido ({d} en 1h).',
    readBtcDriven: 'Es sobre todo BTC: sin BTC el ρ baja a {ex}.',
    readAltFactor: 'No es solo BTC: sin BTC los sectores siguen moviéndose juntos ({ex}).',
    readDecouplingOne: '{names} se está separando.',
    readDecouplingMany: '{names} se están separando.',
  },
);

type MessageKey = keyof (typeof messages)['en'] & string;

const TIME = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const CHART_W = 288;
const CHART_H = 96;
const TICK_MS = 6 * 3_600_000;
const FAST_CHANGE = 0.15;
// ρ − ex-BTC: above this BTC carries most of the co-movement; below the alt line it barely matters.
const BTC_DRIVEN_GAP = 0.25;
const ALT_FACTOR_GAP = 0.15;
const ALT_FACTOR_MIN = 0.5;

const fmtCorr = (v: number | null | undefined) => (v == null ? '—' : v.toFixed(2));
const fmtSigned = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}`;
const fmtPct = (v: number | null | undefined, digits = 0) =>
  v == null ? '—' : `${(v * 100).toFixed(digits)}%`;
const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);

/** The plain-language reading above the chart, as message keys so it localizes. */
export function readingParts(
  data: CryptoSectorCorrelationResponse,
): { key: MessageKey; vars?: Record<string, string> }[] {
  const { current, regime } = data;
  if (!current || current.avgCorr == null || !regime) return [];
  const parts: { key: MessageKey; vars?: Record<string, string> }[] = [
    { key: regime === 'correlated' ? 'readCorrelated' : regime === 'mixed' ? 'readMixed' : 'readDispersed' },
  ];
  if (data.change1h != null && Math.abs(data.change1h) >= FAST_CHANGE) {
    parts.push({
      key: data.change1h > 0 ? 'readRising' : 'readFalling',
      vars: { d: fmtSigned(data.change1h) },
    });
  }
  const ex = current.residualCorr;
  if (regime !== 'dispersed' && ex != null) {
    const gap = current.avgCorr - ex;
    if (gap >= BTC_DRIVEN_GAP) parts.push({ key: 'readBtcDriven', vars: { ex: fmtCorr(ex) } });
    else if (gap < ALT_FACTOR_GAP && ex >= ALT_FACTOR_MIN) {
      parts.push({ key: 'readAltFactor', vars: { ex: fmtCorr(ex) } });
    }
  }
  const breaking = data.sectors.filter((s) => s.decoupled).map((s) => s.name);
  if (breaking.length > 0) {
    parts.push({
      key: breaking.length === 1 ? 'readDecouplingOne' : 'readDecouplingMany',
      vars: { names: breaking.join(', ') },
    });
  }
  return parts;
}

export default function CorrelationStrip() {
  const t = useT(messages);
  const { data, isLoading } = useSectorCorrelation();

  if (!data) {
    return (
      <section className={styles.strip} aria-label={t('title')}>
        <span className={styles.title}>{t('title')}</span>
        <span className={styles.muted}>{isLoading ? t('loading') : t('unavailable')}</span>
      </section>
    );
  }

  return <StripBody data={data} />;
}

function StripBody({ data }: { data: CryptoSectorCorrelationResponse }) {
  const t = useT(messages);
  const { current, regime, baseline, thresholds } = data;
  const hours = (data.windowBars * data.barSec) / 3600;
  const days = ((baseline.windows * data.barSec) / 86_400).toFixed(1);
  const reading = readingParts(data);

  return (
    <section className={styles.strip} aria-label={t('title')}>
      <div className={styles.head}>
        <span className={styles.title}>{t('title')}</span>
        <span className={styles.muted}>{t('basis', { hours })}</span>
        <InfoTip label={t('help')} align="start">
          <p>{t('helpRho', { hours, hi: thresholds.correlated, lo: thresholds.dispersed })}</p>
          <p>{t('helpExBtc')}</p>
          <p>{t('helpPc1')}</p>
          <p>{t('helpSpread', { hours })}</p>
          <p>{t('helpZ', { days })}</p>
        </InfoTip>
        {regime && (
          <span className={styles.regime} data-regime={regime}>
            {t(regime)}
            <span className={styles.since}>
              {data.regimeSince != null
                ? t('since', { time: `${TIME.format(data.regimeSince)} UTC` })
                : t('sinceAll')}
            </span>
          </span>
        )}
      </div>

      {reading.length > 0 && (
        <p className={styles.reading}>{reading.map((p) => t(p.key, p.vars)).join(' ')}</p>
      )}

      <div className={styles.body}>
        <dl className={styles.stats}>
          <div className={styles.stat}>
            <dt>{t('rho')}</dt>
            <dd>
              <span className={styles.big}>{fmtCorr(current?.avgCorr)}</span>
              {data.change1h != null && (
                <span className={styles.delta} data-dir={data.change1h > 0 ? 'up' : 'down'}>
                  {data.change1h > 0 ? '▲' : '▼'}
                  {fmtSigned(data.change1h)}
                  {t('perHour')}
                </span>
              )}
              {data.zScore != null && (
                <span className={styles.muted}>
                  {fmtSigned(data.zScore)}σ {t('vsBaseline', { days })}
                </span>
              )}
            </dd>
          </div>
          <div className={styles.stat}>
            <dt>{t('exBtc')}</dt>
            <dd>{fmtCorr(current?.residualCorr)}</dd>
          </div>
          <div className={styles.stat}>
            <dt>{t('pc1')}</dt>
            <dd>{fmtPct(current?.pc1Share)}</dd>
          </div>
          <div className={styles.stat}>
            <dt>{t('spread')}</dt>
            <dd>{fmtPct(current?.dispersion, 2)}</dd>
          </div>
        </dl>

        <Chart data={data} />
      </div>
    </section>
  );
}

/** SVG path for one series, broken at null points. */
export function seriesPath(
  timeline: readonly CryptoSectorCorrelationPoint[],
  pick: (p: CryptoSectorCorrelationPoint) => number | null,
  y: (v: number) => number,
): string {
  const step = timeline.length > 1 ? CHART_W / (timeline.length - 1) : 0;
  let d = '';
  let pen = false;
  timeline.forEach((p, i) => {
    const v = pick(p);
    if (v == null) {
      pen = false;
      return;
    }
    d += `${pen ? 'L' : 'M'}${(i * step).toFixed(1)} ${y(v).toFixed(1)}`;
    pen = true;
  });
  return d;
}

/** Closed shapes between ρ and ex-BTC, one per run of points where both exist. */
export function gapPath(
  timeline: readonly CryptoSectorCorrelationPoint[],
  y: (v: number) => number,
): string {
  const step = timeline.length > 1 ? CHART_W / (timeline.length - 1) : 0;
  const runs: number[][] = [];
  let run: number[] = [];
  timeline.forEach((p, i) => {
    if (p.avgCorr != null && p.residualCorr != null) run.push(i);
    else if (run.length > 0) {
      runs.push(run);
      run = [];
    }
  });
  if (run.length > 0) runs.push(run);

  return runs
    .filter((r) => r.length > 1)
    .map((r) => {
      const top = r.map((i) => `${(i * step).toFixed(1)} ${y(timeline[i]!.avgCorr!).toFixed(1)}`);
      const bottom = [...r]
        .reverse()
        .map((i) => `${(i * step).toFixed(1)} ${y(timeline[i]!.residualCorr!).toFixed(1)}`);
      return `M${top.join('L')}L${bottom.join('L')}Z`;
    })
    .join('');
}

function Chart({ data }: { data: CryptoSectorCorrelationResponse }) {
  const t = useT(messages);
  const { timeline, thresholds } = data;
  const [hover, setHover] = useState<number | null>(null);

  // Fixed 0..1 scale so the zones stay put; the rare negative reading pins to the floor.
  const y = (v: number) => CHART_H - clamp01(v) * CHART_H;
  const top = (v: number) => `${(1 - clamp01(v)) * 100}%`;
  const left = (i: number) => `${timeline.length > 1 ? (i / (timeline.length - 1)) * 100 : 0}%`;

  const ticks = timeline.flatMap((p, i) => (p.t % TICK_MS === 0 ? [{ i, label: TIME.format(p.t) }] : []));
  const sinceIndex = data.regimeSince != null ? timeline.findIndex((p) => p.t === data.regimeSince) : -1;
  const point = hover != null ? timeline[hover] : undefined;

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    if (box.width === 0 || timeline.length === 0) return;
    const ratio = Math.min(Math.max((e.clientX - box.left) / box.width, 0), 1);
    setHover(Math.round(ratio * (timeline.length - 1)));
  };

  return (
    <figure className={styles.chart}>
      <div className={styles.plotRow}>
        <div
          className={styles.plot}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        >
          <svg
            className={styles.svg}
            viewBox={`0 0 ${CHART_W} ${CHART_H}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <rect
              className={styles.zoneHi}
              x={0}
              width={CHART_W}
              y={0}
              height={y(thresholds.correlated)}
            />
            <rect
              className={styles.zoneLo}
              x={0}
              width={CHART_W}
              y={y(thresholds.dispersed)}
              height={CHART_H - y(thresholds.dispersed)}
            />
            <line className={styles.rule} x1={0} x2={CHART_W} y1={y(thresholds.correlated)} y2={y(thresholds.correlated)} />
            <line className={styles.rule} x1={0} x2={CHART_W} y1={y(thresholds.dispersed)} y2={y(thresholds.dispersed)} />
            <path className={styles.gap} d={gapPath(timeline, y)} />
            <path className={styles.exBtc} d={seriesPath(timeline, (p) => p.residualCorr, y)} />
            <path className={styles.rho} d={seriesPath(timeline, (p) => p.avgCorr, y)} />
          </svg>

          <span className={styles.zoneLabel} data-zone="hi" style={{ top: 0 }}>
            {t('correlated')}
          </span>
          <span
            className={styles.zoneLabel}
            data-zone="mid"
            style={{ top: top((thresholds.correlated + thresholds.dispersed) / 2) }}
          >
            {t('mixed')}
          </span>
          <span className={styles.zoneLabel} data-zone="lo" style={{ bottom: 0 }}>
            {t('dispersed')}
          </span>

          {sinceIndex > 0 && (
            <span className={styles.sinceMark} style={{ left: left(sinceIndex) }} title={t('sinceMark')} />
          )}

          {point && hover != null && (
            <>
              <span className={styles.cursor} style={{ left: left(hover) }} />
              {point.avgCorr != null && (
                <span className={styles.dot} style={{ left: left(hover), top: top(point.avgCorr) }} />
              )}
              <div
                className={styles.tooltip}
                data-side={hover > timeline.length / 2 ? 'left' : 'right'}
                style={{ left: left(hover) }}
              >
                <div className={styles.tooltipTime}>{TIME.format(point.t)} UTC</div>
                <div>
                  {t('rho')} <b>{fmtCorr(point.avgCorr)}</b>
                </div>
                <div>
                  {t('exBtc')} <b>{fmtCorr(point.residualCorr)}</b>
                </div>
                <div>
                  {t('pc1')} <b>{fmtPct(point.pc1Share)}</b> · {t('spread')}{' '}
                  <b>{fmtPct(point.dispersion, 2)}</b>
                </div>
              </div>
            </>
          )}
        </div>

        <div className={styles.yAxis} aria-hidden="true">
          <span style={{ top: top(1) }}>1.0</span>
          <span style={{ top: top(thresholds.correlated) }}>{thresholds.correlated.toFixed(1)}</span>
          <span style={{ top: top(thresholds.dispersed) }}>{thresholds.dispersed.toFixed(1)}</span>
          <span style={{ top: top(0) }}>0</span>
        </div>
      </div>

      <div className={styles.xAxis} aria-hidden="true">
        {ticks.map((tick) => (
          <span key={tick.i} style={{ left: left(tick.i) }}>
            {tick.label}
          </span>
        ))}
        <span className={styles.nowTick}>{t('now')}</span>
      </div>

      <figcaption className={styles.legend}>
        <span data-series="rho">{t('legendRho')}</span>
        <span data-series="ex-btc">{t('legendExBtc')}</span>
        <span data-series="gap">{t('legendGap')}</span>
      </figcaption>
    </figure>
  );
}
