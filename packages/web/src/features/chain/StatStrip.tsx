import type { ReactNode } from 'react';

import type { ChainStats } from '@shared/enriched';
import type { VolRichness, VolRichnessState, WsConnectionState } from '@oggregator/protocol';

import { fmtUsd, fmtUsdCompact, fmtIv, fmtPct, fmtNum } from '@lib/format';
import {
  expiryRichness,
  fmtPercentile,
  fmtVolPts,
  fmtZ,
  richnessTenorFor,
} from '@lib/vol-richness';
import { defineMessages, useT } from '@lib/i18n';
import HoverTooltip from '@components/ui/HoverTooltip';
import type { StatsResponse } from './queries';
import RegimeChip from './RegimeChip';
import BasisTooltip from './BasisTooltip';
import styles from './StatStrip.module.css';

const messages = defineMessages(
  {
    richTitle: 'IV vs forecast (excess premium)',
    richIntro:
      'Is this expiry’s IV cheap or rich against what BTC is likely to realize over the same horizon? Positive: options cost more than the forecast plus the usual premium.',
    richFormula: 'excess = ATM IV − forecast RV − usual (IV − later RV)',
    richConstant:
      '{tenor} constant maturity: excess {excess}, {z} vs its own {samples}-day history, cone {cone} of realized {tenor} vol.',
    richIntraday: 'Intraday: {tenor} IV {z24} vs last 24h, {z7} vs 7d; excess Δ24h {change}.',
    richForecast:
      'Forecast: 7D realized decays to the {longRun}D level, half-life {halfLife}d. Usual premium: median IV − subsequent RV over {samples} independent {tenor} windows.',
    richRange: '52-week 30D DVOL range: {low}–{high}.',
    richFair:
      '±{band} pts reads as fair. The band and half-life are our choices, untested on BTC. Unknown baseline shows “–”, never zero.',
    ivChangeIntro: 'Change in Deribit DVOL from yesterday’s UTC close to the latest live print.',
    ivChangePos: 'Positive (green): IV expanding — premium getting richer day-on-day.',
    ivChangeNeg: 'Negative (red): IV compressing — premium decaying.',
    ivChangeReset:
      'Resets at 00:05 UTC when the day rolls over and a new previousClose anchors the diff.',
    atmIntro:
      'Cross-venue average of at-the-money implied volatility for the currently selected expiry. Averages the mark IV of the call and put closest to the forward, across the active venues.',
    atmExpiryOnly: 'Reflects this expiry only — for a constant-maturity view see the IV Rank panel.',
    atmIvp: 'Pair with IVP to gauge whether this expiry’s IV is rich vs the past year.',
    skewIntro: '25-delta call IV minus 25-delta put IV for the selected expiry.',
    skewNeg: 'Negative (usual in BTC/ETH): puts richer than calls — downside fear priced in.',
    skewPos: 'Positive: calls richer than puts — upside FOMO / squeeze pricing.',
    skewCompress: 'Compression toward zero often precedes regime shifts.',
    pcoiIntro: 'Total put open interest divided by total call open interest for this expiry.',
    pcoiHigh: '> 1: more puts open than calls — hedging / bearish lean.',
    pcoiLow: '< 1: more calls open than puts — directional upside positioning.',
    pcoiSingle: 'Single-expiry only; compare across expiries on the term-structure view.',
    connLive: 'Live',
    connConnecting: 'Connecting',
    connReconnecting: 'Reconnecting',
    connStale: 'Stale',
    connError: 'Error',
    connClosed: 'Offline',
    spot: '{underlying} Spot',
    forward: 'Forward {dte}d {price}',
    toExpiry: '{dte}d to expiry',
    callMinusPut: 'call − put',
    totalOi: 'Total OI',
    basis: 'Basis {value}',
    ivVsFcst: 'IV vs Fcst',
    stateCheap: 'CHEAP',
    stateFair: 'FAIR',
    stateRich: 'RICH',
    stateUnavailable: 'UNAVAILABLE',
    feed: 'Feed',
  },
  {
    richTitle: 'IV vs pronóstico (prima en exceso)',
    richIntro:
      '¿La IV de este vencimiento está barata o cara frente a lo que BTC probablemente realice en el mismo horizonte? Positivo: las opciones cuestan más que el pronóstico más la prima habitual.',
    richFormula: 'exceso = ATM IV − RV pronosticada − habitual (IV − RV posterior)',
    richConstant:
      '{tenor} de madurez constante: exceso {excess}, {z} vs su propio historial de {samples} días, cono {cone} de la vol realizada {tenor}.',
    richIntraday: 'Intradía: IV {tenor} {z24} vs últimas 24h, {z7} vs 7d; Δ24h del exceso {change}.',
    richForecast:
      'Pronóstico: la vol realizada 7D converge al nivel {longRun}D, vida media {halfLife}d. Prima habitual: mediana de IV − RV posterior en {samples} ventanas {tenor} independientes.',
    richRange: 'Rango DVOL 30D de 52 semanas: {low}–{high}.',
    richFair:
      '±{band} pts se considera justo. La banda y la vida media son elecciones nuestras, no probadas en BTC. Sin línea base se muestra “–”, nunca cero.',
    ivChangeIntro: 'Cambio del DVOL de Deribit desde el cierre UTC de ayer hasta el último dato en vivo.',
    ivChangePos: 'Positivo (verde): IV en expansión — la prima se encarece día a día.',
    ivChangeNeg: 'Negativo (rojo): IV en compresión — la prima se desinfla.',
    ivChangeReset:
      'Se reinicia a las 00:05 UTC cuando cambia el día y un nuevo previousClose ancla la diferencia.',
    atmIntro:
      'Promedio entre exchanges de la volatilidad implícita at-the-money para el vencimiento seleccionado. Promedia la mark IV del call y el put más cercanos al forward, en los exchanges activos.',
    atmExpiryOnly: 'Refleja solo este vencimiento — para una vista de madurez constante usa el panel IV Rank.',
    atmIvp: 'Combínalo con IVP para evaluar si la IV de este vencimiento está cara vs el último año.',
    skewIntro: 'IV del call 25-delta menos IV del put 25-delta para el vencimiento seleccionado.',
    skewNeg: 'Negativo (habitual en BTC/ETH): puts más caros que calls — miedo a la baja descontado.',
    skewPos: 'Positivo: calls más caros que puts — FOMO alcista / precio de squeeze.',
    skewCompress: 'La compresión hacia cero suele anteceder cambios de régimen.',
    pcoiIntro: 'Open interest total de puts dividido por el de calls para este vencimiento.',
    pcoiHigh: '> 1: más puts abiertos que calls — cobertura / sesgo bajista.',
    pcoiLow: '< 1: más calls abiertos que puts — posicionamiento direccional alcista.',
    pcoiSingle: 'Solo un vencimiento; compara entre vencimientos en la vista de estructura temporal.',
    connLive: 'En vivo',
    connConnecting: 'Conectando',
    connReconnecting: 'Reconectando',
    connStale: 'Desactualizado',
    connError: 'Error',
    connClosed: 'Desconectado',
    spot: 'Spot {underlying}',
    forward: 'Forward {dte}d {price}',
    toExpiry: '{dte}d al vencimiento',
    callMinusPut: 'call − put',
    totalOi: 'OI total',
    basis: 'Basis {value}',
    ivVsFcst: 'IV vs Pron.',
    stateCheap: 'BARATA',
    stateFair: 'JUSTA',
    stateRich: 'CARA',
    stateUnavailable: 'N/D',
    feed: 'Feed',
  },
);

type MessageKey = keyof typeof messages.en;

const STATE_KEY: Record<VolRichnessState, MessageKey> = {
  cheap: 'stateCheap',
  fair: 'stateFair',
  rich: 'stateRich',
  unavailable: 'stateUnavailable',
};

interface StatStripProps {
  stats: ChainStats;
  underlying: string;
  dte: number;
  connectionState?: WsConnectionState;
  marketStats?: StatsResponse | null;
  richness?: VolRichness | null;
  // Hide the regime chip's Basis × IV dot for venues with no day-over-day IV
  // feed (TradFi). Default true preserves crypto behavior.
  showRegimeIv?: boolean;
}

interface StatCellProps {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
  positive?: boolean | null; // true = green, false = red, null/undefined = neutral
  subPositive?: boolean | null;
  subTooltip?: ReactNode;
  labelTooltip?: ReactNode;
}

function StatCell({
  label,
  value,
  sub,
  accent,
  positive,
  subPositive,
  subTooltip,
  labelTooltip,
}: StatCellProps) {
  const labelNode = labelTooltip ? (
    <HoverTooltip
      as="span"
      className={styles.label}
      placement="bottom-start"
      content={labelTooltip}
      dataInteractive="true"
    >
      {label}
    </HoverTooltip>
  ) : (
    <span className={styles.label}>{label}</span>
  );

  return (
    <div className={styles.cell}>
      {labelNode}
      <span
        className={styles.value}
        data-accent={accent}
        data-positive={positive === true ? 'true' : positive === false ? 'false' : undefined}
      >
        {value}
      </span>
      {sub &&
        (subTooltip ? (
          <HoverTooltip
            as="span"
            className={styles.sub}
            placement="bottom-start"
            content={subTooltip}
            dataPositive={
              subPositive === true ? 'true' : subPositive === false ? 'false' : undefined
            }
            dataInteractive="true"
          >
            {sub}
          </HoverTooltip>
        ) : (
          <span
            className={styles.sub}
            data-positive={
              subPositive === true ? 'true' : subPositive === false ? 'false' : undefined
            }
          >
            {sub}
          </span>
        ))}
    </div>
  );
}

function RichnessTip({
  richness,
  atmIv,
  dte,
  range52w,
}: {
  richness: VolRichness;
  atmIv: number | null;
  dte: number;
  range52w: { low: number; high: number } | null;
}) {
  const t = useT(messages);
  const expiry = expiryRichness(richness, atmIv, dte);
  const tenor = richnessTenorFor(richness, dte);
  const tenorLabel = `${tenor.tenorDays}D`;
  return (
    <div className={styles.statTip}>
      <div className={styles.statTipTitle}>{t('richTitle')}</div>
      <div>{t('richIntro')}</div>
      <div className={styles.statTipFormula}>{t('richFormula')}</div>
      <div className={styles.statTipFormula}>
        {fmtIv(atmIv)} − {fmtIv(expiry.forecastVol)} − {fmtVolPts(expiry.usualPremium)} ={' '}
        {fmtVolPts(expiry.excessPremium)}
      </div>
      <ul className={styles.statTipList}>
        <li>
          {t('richConstant', {
            tenor: tenorLabel,
            excess: fmtVolPts(tenor.excessPremium),
            z: fmtZ(tenor.excessHistory.zScore),
            samples: tenor.excessHistory.sampleCount,
            cone: fmtPercentile(tenor.conePercentile),
          })}
        </li>
        <li>
          {t('richIntraday', {
            tenor: tenorLabel,
            z24: fmtZ(tenor.intraday.zScore24h),
            z7: fmtZ(tenor.intraday.zScore7d),
            change: fmtVolPts(tenor.excessChange24h),
          })}
        </li>
        <li>
          {t('richForecast', {
            longRun: richness.forecast.longRunDays,
            halfLife: richness.forecast.halfLifeDays,
            samples: tenor.premiumBaseline.independentSampleCount,
            tenor: tenorLabel,
          })}
        </li>
        {range52w && (
          <li>{t('richRange', { low: fmtIv(range52w.low), high: fmtIv(range52w.high) })}</li>
        )}
        <li>{t('richFair', { band: (richness.fairBand * 100).toFixed(0) })}</li>
      </ul>
    </div>
  );
}

function TipBody({
  title,
  intro,
  items,
}: {
  title: string;
  intro: string;
  items: readonly string[];
}) {
  return (
    <div className={styles.statTip}>
      <div className={styles.statTipTitle}>{title}</div>
      <div>{intro}</div>
      <ul className={styles.statTipList}>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

const CONN_DISPLAY: Record<WsConnectionState, { dot: string; label: MessageKey }> = {
  live: { dot: 'var(--color-profit)', label: 'connLive' },
  connecting: { dot: 'var(--text-dim)', label: 'connConnecting' },
  reconnecting: { dot: 'var(--color-warning, orange)', label: 'connReconnecting' },
  stale: { dot: 'var(--color-warning, orange)', label: 'connStale' },
  error: { dot: 'var(--color-loss)', label: 'connError' },
  closed: { dot: 'var(--text-dim)', label: 'connClosed' },
};

export default function StatStrip({
  stats,
  underlying,
  dte,
  connectionState,
  marketStats,
  richness,
  showRegimeIv = true,
}: StatStripProps) {
  const t = useT(messages);
  const expiry = richness ? expiryRichness(richness, stats.atmIv, dte) : null;
  const expiryTenor = richness ? richnessTenorFor(richness, dte) : null;
  const basisSub = stats.basisPct != null ? fmtPct(stats.basisPct, 3) : undefined;
  const basisPositive =
    stats.basisPct != null ? (stats.basisPct > 0 ? true : stats.basisPct < 0 ? false : null) : null;

  const skewPositive = stats.skew25d != null ? stats.skew25d > 0 : null;

  return (
    <div className={styles.strip}>
      <StatCell
        label={t('spot', { underlying })}
        value={fmtUsd(stats.indexPriceUsd)}
        sub={
          stats.forwardPriceUsd != null
            ? t('forward', { dte, price: fmtUsd(stats.forwardPriceUsd) })
            : undefined
        }
      />
      <div className={styles.divider} />
      <StatCell
        label="ATM IV"
        value={fmtIv(stats.atmIv)}
        accent
        labelTooltip={
          <TipBody
            title="ATM IV"
            intro={t('atmIntro')}
            items={[t('atmExpiryOnly'), t('atmIvp')]}
          />
        }
      />
      <div className={styles.divider} />
      <StatCell
        label="Put/Call OI"
        value={stats.putCallOiRatio != null ? fmtNum(stats.putCallOiRatio) : '–'}
        sub={t('toExpiry', { dte })}
        labelTooltip={
          <TipBody
            title="Put / Call OI"
            intro={t('pcoiIntro')}
            items={[t('pcoiHigh'), t('pcoiLow'), t('pcoiSingle')]}
          />
        }
      />
      <div className={styles.divider} />
      <StatCell
        label="25Δ Skew"
        value={stats.skew25d != null ? fmtIv(stats.skew25d) : '–'}
        sub={t('callMinusPut')}
        positive={skewPositive}
        labelTooltip={
          <TipBody
            title="25Δ Skew"
            intro={t('skewIntro')}
            items={[t('skewNeg'), t('skewPos'), t('skewCompress')]}
          />
        }
      />
      <div className={styles.divider} />
      <StatCell
        label={t('totalOi')}
        value={fmtUsdCompact(stats.totalOiUsd)}
        sub={basisSub ? t('basis', { value: basisSub }) : undefined}
        subPositive={basisPositive}
        subTooltip={
          stats.basisPct != null && dte > 0 ? (
            <BasisTooltip basisPct={stats.basisPct} dte={dte} />
          ) : undefined
        }
      />
      {richness && expiry && expiryTenor && (
        <>
          <div className={styles.divider} />
          <StatCell
            label={t('ivVsFcst')}
            value={fmtVolPts(expiry.excessPremium)}
            positive={
              expiry.state === 'cheap' ? true : expiry.state === 'rich' ? false : null
            }
            sub={`${t(STATE_KEY[expiry.state])} · ${expiryTenor.tenorDays}D ${fmtZ(
              expiryTenor.intraday.zScore24h,
            )} 24h`}
            labelTooltip={
              <RichnessTip
                richness={richness}
                atmIv={stats.atmIv}
                dte={dte}
                range52w={
                  marketStats?.dvol?.low52w != null && marketStats.dvol.high52w != null
                    ? { low: marketStats.dvol.low52w, high: marketStats.dvol.high52w }
                    : null
                }
              />
            }
          />
        </>
      )}
      {marketStats?.dvol && (
        <>
          <div className={styles.divider} />
          <StatCell
            label="IV Δ1d"
            value={
              marketStats.dvol.ivChange1d != null
                ? fmtPct(marketStats.dvol.ivChange1d * 100, 2)
                : '–'
            }
            positive={
              marketStats.dvol.ivChange1d == null
                ? null
                : marketStats.dvol.ivChange1d > 0
                  ? true
                  : marketStats.dvol.ivChange1d < 0
                    ? false
                    : null
            }
            labelTooltip={
              <TipBody
                title="IV Δ1d"
                intro={t('ivChangeIntro')}
                items={[t('ivChangePos'), t('ivChangeNeg'), t('ivChangeReset')]}
              />
            }
          />
        </>
      )}
      <div className={styles.divider} />
      <RegimeChip
        basisPct={stats.basisPct}
        skew25d={stats.skew25d}
        ivChange1d={marketStats?.dvol?.ivChange1d ?? null}
        putCallOiRatio={stats.putCallOiRatio}
        showIvSignal={showRegimeIv}
      />
      {connectionState && (
        <>
          <div className={styles.divider} />
          <div className={styles.cell}>
            <span className={styles.label}>{t('feed')}</span>
            <span className={styles.feedState}>
              <span
                className={styles.feedDot}
                data-state={connectionState}
                style={{ background: CONN_DISPLAY[connectionState].dot }}
              />
              {t(CONN_DISPLAY[connectionState].label)}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
