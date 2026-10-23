import { fmtIv, fmtPct, fmtUsdCompact } from '@lib/format';
import { defineMessages, useT } from '@lib/i18n';
import { fmtPercentile, fmtVolPts, fmtZ } from '@lib/vol-richness';
import type { AlphaMarketContextResponse } from '@oggregator/protocol';

import styles from './AlphaContextStrip.module.css';

interface AlphaContextStripProps {
  context: AlphaMarketContextResponse | null;
  strategy:
    | 'call-credit'
    | 'put-credit'
    | 'call-debit'
    | 'put-debit'
    | 'long-call'
    | 'long-put'
    | 'short-straddle'
    | 'long-straddle'
    | 'iron-fly';
  loading: boolean;
}

const messages = defineMessages(
  {
    aria: 'Alpha market context',
    setupTitle:
      'Broad market heuristic, not a trade verdict. Past realized volatility is not a forecast. An unfavorable selling setup does not imply buying is profitable.',
    setupHeuristic: 'Setup heuristic ⓘ',
    loading: 'LOADING',
    UNAVAILABLE: 'UNAVAILABLE',
    'CHECK DIRECTION + PRICE': 'CHECK DIRECTION + PRICE',
    FAVORABLE: 'FAVORABLE',
    WATCH: 'WATCH',
    EXPENSIVE: 'EXPENSIVE',
    UNFAVORABLE: 'UNFAVORABLE',
    CHEAP: 'CHEAP',
    FAIR: 'FAIR',
    RICH: 'RICH',
    COILED: 'COILED',
    NORMAL: 'NORMAL',
    EXPANDED: 'EXPANDED',
    'INSIDE RANGE': 'INSIDE RANGE',
    'BREAKING OUT': 'BREAKING OUT',
    EXTENDED: 'EXTENDED',
    ivContextTitle:
      'Context only: IV against its own 90-day past, not against expected realized volatility.',
    ivHistory: 'IV history {days} / {min}d',
    richnessTitle:
      'IV − matched-horizon realized forecast − usual premium (median IV − later RV). ±{band} pts reads as fair; thresholds are untested on BTC. Volatility state source: {source}.',
    unavailableLower: 'unavailable',
    ivVsFcst: 'IV vs FCST 30D / 7D',
    hist: 'hist',
    implied7d: '7D IMPLIED',
    range: 'RANGE',
    spotState: 'SPOT STATE',
    mixedScope: '30D DVOL + venue IV',
    crossVenueScope: 'cross-venue IV',
  },
  {
    aria: 'Contexto de mercado Alpha',
    setupTitle:
      'Heurística amplia de mercado, no un veredicto de trade. La volatilidad realizada pasada no es un pronóstico. Un setup desfavorable para vender no implica que comprar sea rentable.',
    setupHeuristic: 'Heurística de setup ⓘ',
    loading: 'CARGANDO',
    UNAVAILABLE: 'NO DISPONIBLE',
    'CHECK DIRECTION + PRICE': 'REVISA DIRECCIÓN + PRECIO',
    FAVORABLE: 'FAVORABLE',
    WATCH: 'VIGILAR',
    EXPENSIVE: 'CARO',
    UNFAVORABLE: 'DESFAVORABLE',
    CHEAP: 'BARATO',
    FAIR: 'JUSTO',
    RICH: 'CARO',
    COILED: 'COMPRIMIDO',
    NORMAL: 'NORMAL',
    EXPANDED: 'EXPANDIDO',
    'INSIDE RANGE': 'DENTRO DEL RANGO',
    'BREAKING OUT': 'ROMPIENDO',
    EXTENDED: 'EXTENDIDO',
    ivContextTitle:
      'Solo contexto: IV frente a sus propios últimos 90 días, no frente a la volatilidad realizada esperada.',
    ivHistory: 'Historial IV {days} / {min}d',
    richnessTitle:
      'IV − pronóstico realizado al mismo horizonte − prima habitual (IV mediana − RV posterior). ±{band} pts se considera justo; los umbrales no están probados en BTC. Fuente del estado de volatilidad: {source}.',
    unavailableLower: 'no disponible',
    ivVsFcst: 'IV vs PRON 30D / 7D',
    hist: 'hist',
    implied7d: 'IMPLÍCITO 7D',
    range: 'RANGO',
    spotState: 'ESTADO SPOT',
    mixedScope: 'DVOL 30D + IV del exchange',
    crossVenueScope: 'IV entre exchanges',
  },
);

type MessageKey = keyof typeof messages.en;

function isMessageKey(value: string): value is MessageKey {
  return value in messages.en;
}

// Mirrors MIN_RANK_HISTORY_DAYS in core's IvHistoryService, which withholds percentiles until then.
const MIN_PERCENTILE_HISTORY_DAYS = 7;

function historyBuilding(context: AlphaMarketContextResponse | null): boolean {
  const days = context?.volatility.ivHistoryDays;
  return days != null && days < MIN_PERCENTILE_HISTORY_DAYS;
}

function setupLabel(
  context: AlphaMarketContextResponse | null,
  strategy: AlphaContextStripProps['strategy'],
): string {
  if (context == null) return 'UNAVAILABLE';
  if (strategy.endsWith('debit')) return 'CHECK DIRECTION + PRICE';
  if (strategy === 'long-call' || strategy === 'long-straddle') {
    return context.setup.longCall.toUpperCase();
  }
  if (strategy === 'long-put') return context.setup.protectivePut.toUpperCase();
  return context.setup.creditSpread.toUpperCase();
}

export default function AlphaContextStrip({ context, strategy, loading }: AlphaContextStripProps) {
  const t = useT(messages);
  const label = (value: string) => (isMessageKey(value) ? t(value) : value);
  const setup = setupLabel(context, strategy);
  const move7d = context?.expectedMoves.find((move) => move.days === 7) ?? null;
  const vrp = context?.realized.vrp30d;
  const richness30d = context?.richness?.tenors['30d'] ?? null;
  const richness7d = context?.richness?.tenors['7d'] ?? null;
  const stateSource = context?.volatility.stateSource;
  return (
    <div className={styles.strip} aria-label={t('aria')}>
      <div
        className={styles.setup}
        data-fit={setup.toLowerCase()}
        title={t('setupTitle')}
      >
        <span>{t('setupHeuristic')}</span>
        <strong>{loading ? t('loading') : label(setup)}</strong>
      </div>
      <div>
        <span>ATM IV 30D</span>
        <strong>{fmtIv(context?.volatility.atmIv30d ?? null)}</strong>
        <small title={t('ivContextTitle')}>
          {historyBuilding(context)
            ? t('ivHistory', {
                days: (context?.volatility.ivHistoryDays ?? 0).toFixed(1),
                min: MIN_PERCENTILE_HISTORY_DAYS,
              })
            : `90d ${fmtPercentile(context?.volatility.ivPercentile30d)}`}
        </small>
      </div>
      <div
        title={t('richnessTitle', {
          band: ((context?.richness?.fairBand ?? 0.02) * 100).toFixed(0),
          source: stateSource ?? t('unavailableLower'),
        })}
      >
        <span>{t('ivVsFcst')}</span>
        <strong>
          {fmtVolPts(richness30d?.excessPremium)} / {fmtVolPts(richness7d?.excessPremium)}
        </strong>
        <small>
          {label(richness30d?.state.toUpperCase() ?? 'UNAVAILABLE')} ·{' '}
          {fmtZ(richness30d?.excessHistory.zScore)} {t('hist')} · 7D {fmtZ(richness7d?.intraday.zScore24h)} 24h
        </small>
      </div>
      <div>
        <span>RV 7D / 30D</span>
        <strong>
          {fmtIv(context?.realized.rv7d ?? null)} / {fmtIv(context?.realized.rv30d ?? null)}
        </strong>
      </div>
      <div>
        <span>VRP 30D</span>
        <strong>{vrp == null ? '—' : `${(vrp * 100).toFixed(1)}pp`}</strong>
      </div>
      <div>
        <span>{t('implied7d')}</span>
        <strong>{fmtPct(move7d?.movePct ?? null, 1)}</strong>
        <small>{fmtUsdCompact(move7d?.moveUsd ?? null)}</small>
      </div>
      <div>
        <span>{t('range')}</span>
        <strong>{context ? label(context.range.state.toUpperCase()) : '—'}</strong>
        <small>{fmtPct(context?.range.width14dPct ?? null, 1)} / 14d</small>
      </div>
      <div>
        <span>{t('spotState')}</span>
        <strong>
          {context ? label(context.spotState.state.replaceAll('-', ' ').toUpperCase()) : '—'}
        </strong>
        <small>
          {context?.sources.ivScope === 'mixed' ? t('mixedScope') : t('crossVenueScope')}
        </small>
      </div>
    </div>
  );
}
