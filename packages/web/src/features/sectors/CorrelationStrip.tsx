import { InfoTip } from '@components/ui';
import { defineMessages, useT } from '@lib/i18n';
import type {
  CryptoSectorCorrelationPoint,
  CryptoSectorCorrelationResponse,
} from '@oggregator/protocol';

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
    rho: 'ρ sectors',
    exBtc: 'ρ ex-BTC',
    pc1: 'PC1',
    spread: 'spread',
    vsBaseline: 'vs {days}d',
    perHour: '/1h',
    now: 'now',
    ago: '−24h',
    legendRho: 'ρ',
    legendExBtc: 'ex-BTC',
    help: 'How to read this',
    helpRho:
      'ρ sectors: average correlation between the 11 equal-weight sector baskets over the last {hours}h of 5m returns. Correlated ≥ {hi}, dispersed ≤ {lo}.',
    helpExBtc:
      'ρ ex-BTC: the same after removing each sector’s BTC beta. High means sectors move together beyond what BTC explains.',
    helpPc1: 'PC1: share of sector variance explained by one common factor.',
    helpSpread: 'Spread: how far apart the sectors’ {hours}h moves are. Low spread + high ρ = herd move; high spread = rotation.',
    helpZ: 'σ: how unusual ρ is against the last {days} days.',
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
    rho: 'ρ sectores',
    exBtc: 'ρ sin BTC',
    pc1: 'PC1',
    spread: 'dispersión',
    vsBaseline: 'vs {days}d',
    perHour: '/1h',
    now: 'ahora',
    ago: '−24h',
    legendRho: 'ρ',
    legendExBtc: 'sin BTC',
    help: 'Cómo leer esto',
    helpRho:
      'ρ sectores: correlación promedio entre las 11 canastas sectoriales (pesos iguales) en las últimas {hours}h de retornos de 5m. Correlacionado ≥ {hi}, disperso ≤ {lo}.',
    helpExBtc:
      'ρ sin BTC: lo mismo tras quitar la beta a BTC de cada sector. Alto significa que los sectores se mueven juntos más allá de lo que explica BTC.',
    helpPc1: 'PC1: proporción de la varianza sectorial explicada por un solo factor común.',
    helpSpread:
      'Dispersión: qué tan separados están los movimientos de {hours}h de los sectores. Baja dispersión + ρ alto = movimiento en manada; alta = rotación.',
    helpZ: 'σ: qué tan inusual es ρ frente a los últimos {days} días.',
  },
);

const TIME = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const CHART_W = 288;
const CHART_H = 56;

const fmtCorr = (v: number | null | undefined) => (v == null ? '—' : v.toFixed(2));
const fmtSigned = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}`;

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
            <dd>{current?.pc1Share != null ? `${Math.round(current.pc1Share * 100)}%` : '—'}</dd>
          </div>
          <div className={styles.stat}>
            <dt>{t('spread')}</dt>
            <dd>
              {current?.dispersion != null ? `${(current.dispersion * 100).toFixed(2)}%` : '—'}
            </dd>
          </div>
        </dl>

        <figure className={styles.chart}>
          <Sparkline timeline={data.timeline} thresholds={thresholds} />
          <figcaption className={styles.axis}>
            <span>{t('ago')}</span>
            <span className={styles.legend}>
              <span data-series="rho">{t('legendRho')}</span>
              <span data-series="ex-btc">{t('legendExBtc')}</span>
            </span>
            <span>{t('now')}</span>
          </figcaption>
        </figure>
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

function Sparkline({
  timeline,
  thresholds,
}: {
  timeline: readonly CryptoSectorCorrelationPoint[];
  thresholds: CryptoSectorCorrelationResponse['thresholds'];
}) {
  const values = timeline.flatMap((p) => [p.avgCorr, p.residualCorr]).filter((v) => v != null);
  const lo = Math.min(0, ...values);
  const y = (v: number) => CHART_H - ((v - lo) / (1 - lo)) * CHART_H;

  return (
    <svg
      className={styles.svg}
      viewBox={`0 0 ${CHART_W} ${CHART_H}`}
      preserveAspectRatio="none"
      role="img"
      aria-hidden="true"
    >
      <rect
        className={styles.band}
        x={0}
        width={CHART_W}
        y={y(1)}
        height={y(thresholds.correlated) - y(1)}
      />
      <line className={styles.rule} x1={0} x2={CHART_W} y1={y(thresholds.correlated)} y2={y(thresholds.correlated)} />
      <line className={styles.rule} x1={0} x2={CHART_W} y1={y(thresholds.dispersed)} y2={y(thresholds.dispersed)} />
      <path className={styles.exBtc} d={seriesPath(timeline, (p) => p.residualCorr, y)} />
      <path className={styles.rho} d={seriesPath(timeline, (p) => p.avgCorr, y)} />
    </svg>
  );
}
