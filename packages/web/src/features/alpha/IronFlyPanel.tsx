import { useDeferredValue, useState } from 'react';
import {
  VenueIdSchema,
  type AlphaIronFlyCandidate,
  type AlphaIronFlyFlag,
  type AlphaIronFlyHistoryStats,
  type AlphaIronFlyScannerResponse,
  type AlphaIronFlyVerdict,
  type AlphaIronFlyWindowSet,
  type VenueId,
} from '@oggregator/protocol';

import { Spinner } from '@components/ui';
import { useStrategyStore } from '@features/architect/strategy-store';
import { fmtIv, fmtStrike, fmtUsdCompact, formatExpiry } from '@lib/format';
import { defineMessages, useT } from '@lib/i18n';
import { VENUES } from '@lib/venue-meta';
import { useAppStore } from '@stores/app-store';

import { alphaMessages } from './i18n';
import { ironFlyToBuilderLegs } from './radar-builder';
import { useIronFlyScanner } from './useIronFlyScanner';
import shared from './StraddleScannerPanel.module.css';
import styles from './IronFlyPanel.module.css';

const DTE_PRESETS = [
  { label: '0–3D', minDte: 0, maxDte: 3 },
  { label: '0–7D', minDte: 0, maxDte: 7 },
  { label: '7–21D', minDte: 7, maxDte: 21 },
] as const;
const LOOKBACKS = [
  { label: '2Y', weeks: 104 },
  { label: '3Y', weeks: 156 },
  { label: '6Y', weeks: 312 },
] as const;
const MAX_SPREAD_PCT = 40;
const HISTOGRAM_BINS = 36;

const messages = defineMessages(
  {
    eyebrow: '{underlying} · {n} ACTIVE VENUES · SHORT IRON FLIES',
    title: 'Sell the ATM straddle, buy the wings: where did comparable settlements land?',
    description:
      "Each fly sells the ATM call and put at the bids and buys symmetric wings at the asks, after taker fees on all four legs. Today's net credit is scored with the full expiry payoff against past windows that start at this hour of the week and settle at the expiry's hour. The last {holdout} weeks are held out of ranking.",
    lookback: 'History',
    maxLossBudget: 'Max-loss budget',
    maxLossAria: 'Percent of equity that the fly max loss may use',
    invalidSizing: 'Enter positive equity and a max-loss budget between 0 and 100%.',
    noHistory:
      'No hourly settlement history for {underlying}, so every fly is thin-history. Live prices are still shown.',
    countPositive: '{n} POSITIVE',
    countNegative: '{n} NEGATIVE',
    noFlies: 'No priced iron fly in this window for {underlying}.',
    expiry: 'Expiry',
    venue: 'Venue',
    wings: 'Wings',
    credit: 'Net credit',
    maxLoss: 'Max loss',
    zone: 'Profit zone',
    histWin: 'Hist. win',
    impliedWin: 'Implied win',
    fitMean: 'Mean P&L',
    holdoutMean: 'Holdout mean',
    worst: 'Worst',
    verdict: 'Verdict',
    'historically-positive': 'Positive',
    watch: 'Watch',
    'historically-negative': 'Negative',
    'thin-history': 'Thin history',
    legs: 'Legs',
    sell: 'Sell',
    buy: 'Buy',
    fees: 'Taker fees {fees} · net credit {credit} · max loss {loss} per 1 {underlying}',
    statFit: 'Fit · {n} windows',
    statHoldout: 'Holdout · last {n}',
    statImplied: 'Implied at {iv} mark IV',
    profitRate: 'Profit rate',
    meanPnl: 'Mean P&L / fly',
    ci: '95% CI {low} to {high}',
    worstObserved: 'Worst observed',
    atSize: 'At {qty} {underlying}',
    atSizeDetail: 'credit {credit} · max loss {loss} · fit mean {mean}',
    sizeZero: 'Below the venue minimum at this budget or book size.',
    chartTitle: 'Past settlements on today’s forward ({n}), with the fly payoff',
    chartAria: 'Histogram of comparable past settlements against the iron fly payoff',
    flags: 'Why this verdict',
    allClear: 'Fit mean, holdout mean and confidence interval are all positive. This is not a recommendation.',
    flag_fit_mean_negative: 'Mean P&L on the fit windows is at or below zero at today’s credit.',
    flag_holdout_mean_negative: 'Mean P&L on the recent holdout weeks is at or below zero.',
    flag_ci_includes_zero: 'The 95% interval of the fit mean includes zero.',
    flag_thin_history: 'Fewer than 52 fit windows.',
    flag_overlapping_windows: 'Windows longer than a week overlap, so they count as fewer independent samples.',
    flag_size_below_minimum: 'Budget or top of book is below the venue minimum size.',
    caveats:
      "Today's credit against past settlement locations, not a backtest of past option prices. A high profit rate can coexist with a negative mean. Expiry payoff only: early exits and margin paths are not modeled. Settlement is proxied by the perp's hourly close at the expiry hour, not the venue's index average. Settlement fees are not included. Check the fly against your whole book with the Portfolio Assistant before trading.",
    openInBuilder: 'Open in builder',
  },
  {
    eyebrow: '{underlying} · {n} EXCHANGES ACTIVOS · IRON FLIES VENDIDOS',
    title: 'Vende el straddle ATM, compra las alas: ¿dónde liquidaron los fines comparables?',
    description:
      'Cada fly vende la call y la put ATM en los bids y compra alas simétricas en los asks, después de comisiones taker en las cuatro patas. El crédito neto de hoy se evalúa con el payoff completo al vencimiento contra ventanas pasadas que empiezan a esta hora de la semana y liquidan a la hora del vencimiento. Las últimas {holdout} semanas quedan fuera del ranking.',
    lookback: 'Historia',
    maxLossBudget: 'Presupuesto de pérdida máx.',
    maxLossAria: 'Porcentaje del capital que puede usar la pérdida máxima del fly',
    invalidSizing: 'Ingresa un capital positivo y un presupuesto de pérdida máx. entre 0 y 100%.',
    noHistory:
      'No hay historia horaria de liquidación para {underlying}, así que todo fly queda con historia insuficiente. Los precios en vivo se muestran igual.',
    countPositive: '{n} POSITIVOS',
    countNegative: '{n} NEGATIVOS',
    noFlies: 'No hay iron fly con precio en esta ventana para {underlying}.',
    expiry: 'Vencimiento',
    venue: 'Exchange',
    wings: 'Alas',
    credit: 'Crédito neto',
    maxLoss: 'Pérdida máx.',
    zone: 'Zona de ganancia',
    histWin: 'Gana hist.',
    impliedWin: 'Gana implícito',
    fitMean: 'P&L medio',
    holdoutMean: 'Media holdout',
    worst: 'Peor',
    verdict: 'Veredicto',
    'historically-positive': 'Positivo',
    watch: 'Vigilar',
    'historically-negative': 'Negativo',
    'thin-history': 'Historia corta',
    legs: 'Patas',
    sell: 'Vender',
    buy: 'Comprar',
    fees: 'Comisiones taker {fees} · crédito neto {credit} · pérdida máx. {loss} por 1 {underlying}',
    statFit: 'Ajuste · {n} ventanas',
    statHoldout: 'Holdout · últimas {n}',
    statImplied: 'Implícito a IV mark {iv}',
    profitRate: 'Tasa de ganancia',
    meanPnl: 'P&L medio / fly',
    ci: 'IC 95% {low} a {high}',
    worstObserved: 'Peor observado',
    atSize: 'Con {qty} {underlying}',
    atSizeDetail: 'crédito {credit} · pérdida máx. {loss} · media ajuste {mean}',
    sizeZero: 'Por debajo del mínimo del exchange con este presupuesto o tamaño del libro.',
    chartTitle: 'Liquidaciones pasadas sobre el forward de hoy ({n}), con el payoff del fly',
    chartAria: 'Histograma de liquidaciones pasadas comparables contra el payoff del iron fly',
    flags: 'Por qué este veredicto',
    allClear: 'La media de ajuste, la media holdout y el intervalo de confianza son positivos. No es una recomendación.',
    flag_fit_mean_negative: 'El P&L medio en las ventanas de ajuste es cero o negativo con el crédito de hoy.',
    flag_holdout_mean_negative: 'El P&L medio en las semanas recientes de holdout es cero o negativo.',
    flag_ci_includes_zero: 'El intervalo del 95% de la media de ajuste incluye cero.',
    flag_thin_history: 'Menos de 52 ventanas de ajuste.',
    flag_overlapping_windows: 'Las ventanas de más de una semana se solapan, así que cuentan como menos muestras independientes.',
    flag_size_below_minimum: 'El presupuesto o el tope del libro está por debajo del tamaño mínimo del exchange.',
    caveats:
      'Crédito de hoy contra dónde liquidó el precio en el pasado, no un backtest de precios de opciones pasados. Una tasa de ganancia alta puede convivir con una media negativa. Solo payoff al vencimiento: no modela salidas anticipadas ni el camino del margen. La liquidación se aproxima con el cierre horario del perpetuo a la hora del vencimiento, no con el promedio del índice del exchange. No incluye comisiones de liquidación. Revisa el fly contra todo tu libro con el Portfolio Assistant antes de operar.',
    openInBuilder: 'Abrir en el builder',
  },
);

type Messages = typeof messages.en;

function scannerVenues(venues: string[]): VenueId[] {
  return venues.flatMap((venue) => {
    const parsed = VenueIdSchema.safeParse(venue);
    return parsed.success ? [parsed.data] : [];
  });
}

function parseInput(value: string, max: number): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= max ? parsed : null;
}

function flyKey(candidate: AlphaIronFlyCandidate): string {
  return `${candidate.venue}:${candidate.expiry}:${candidate.center}:${candidate.width}`;
}

function signedUsd(value: number | null): string {
  if (value == null) return '–';
  const rounded = Math.round(value);
  if (rounded === 0) return '$0';
  return `${rounded > 0 ? '+' : '-'}$${Math.abs(rounded).toLocaleString('en-US')}`;
}

function usd(value: number): string {
  return `$${Math.round(value).toLocaleString('en-US')}`;
}

function rate(value: number | null): string {
  return value == null ? '–' : `${(value * 100).toFixed(0)}%`;
}

function tone(value: number | null): 'profit' | 'loss' | undefined {
  if (value == null) return undefined;
  return value > 0 ? 'profit' : 'loss';
}

interface IronFlyPanelProps {
  underlying: string;
  venues: string[];
}

export default function IronFlyPanel({ underlying, venues }: IronFlyPanelProps) {
  const t = useT(messages);
  const ta = useT(alphaMessages);
  const [dtePreset, setDtePreset] = useState(1);
  const [lookback, setLookback] = useState(1);
  const [equityInput, setEquityInput] = useState('10000');
  const [riskInput, setRiskInput] = useState('1');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const replaceLegs = useStrategyStore((state) => state.replaceLegs);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const setBuilderVariant = useAppStore((state) => state.setBuilderVariant);
  const setExpiry = useAppStore((state) => state.setExpiry);
  const equity = parseInput(equityInput, 100_000_000);
  const riskPct = parseInput(riskInput, 100);
  const sizingValid = equity != null && riskPct != null;
  const deferredEquity = useDeferredValue(equity ?? 10_000);
  const deferredRisk = useDeferredValue(riskPct ?? 1);
  const activeVenues = scannerVenues(venues);
  const dte = DTE_PRESETS[dtePreset]!;

  const query = useIronFlyScanner(
    {
      underlying,
      venues: activeVenues,
      minDte: dte.minDte,
      maxDte: dte.maxDte,
      equity: deferredEquity,
      riskPct: deferredRisk,
      maxSpreadPct: MAX_SPREAD_PCT,
      lookbackWeeks: LOOKBACKS[lookback]!.weeks,
      limit: 40,
    },
    activeVenues.length > 0 && sizingValid,
  );
  const data = query.data;
  const selected =
    data?.candidates.find((candidate) => flyKey(candidate) === selectedKey) ??
    data?.candidates[0] ??
    null;
  const unavailableVenues = data?.venueStatus.filter((status) => status.error != null) ?? [];

  function openInBuilder(candidate: AlphaIronFlyCandidate): void {
    replaceLegs(ironFlyToBuilderLegs(candidate), candidate.underlying);
    setExpiry(candidate.expiry);
    setBuilderVariant('v2');
    setActiveTab('architect');
  }

  return (
    <section className={shared.panel}>
      <header className={shared.header}>
        <div>
          <div className={shared.eyebrow}>{t('eyebrow', { underlying, n: activeVenues.length })}</div>
          <h2 className={shared.title}>{t('title')}</h2>
          <p className={shared.description}>
            {t('description', { holdout: data?.history.holdoutWeeks ?? 26 })}
          </p>
        </div>
        <span className={shared.scanOnly}>{ta('scanOnly')}</span>
      </header>

      <div className={shared.controls}>
        <fieldset className={shared.controlGroup}>
          <legend>{ta('expiryWindow')}</legend>
          <div className={shared.presetRow}>
            {DTE_PRESETS.map((preset, index) => (
              <button
                type="button"
                key={preset.label}
                data-active={dtePreset === index}
                aria-pressed={dtePreset === index}
                onClick={() => setDtePreset(index)}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className={shared.controlGroup}>
          <legend>{t('lookback')}</legend>
          <div className={shared.presetRow}>
            {LOOKBACKS.map((preset, index) => (
              <button
                type="button"
                key={preset.label}
                data-active={lookback === index}
                aria-pressed={lookback === index}
                onClick={() => setLookback(index)}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </fieldset>
        <label className={shared.inputControl} data-invalid={equity == null || undefined}>
          <span>{ta('equity')}</span>
          <div className={shared.inputShell}>
            <span>$</span>
            <input
              inputMode="decimal"
              value={equityInput}
              aria-label={ta('equityAria')}
              aria-invalid={equity == null}
              onChange={(event) => setEquityInput(event.target.value)}
            />
          </div>
        </label>
        <label className={shared.inputControl} data-invalid={riskPct == null || undefined}>
          <span>{t('maxLossBudget')}</span>
          <div className={shared.inputShell}>
            <input
              inputMode="decimal"
              value={riskInput}
              aria-label={t('maxLossAria')}
              aria-invalid={riskPct == null}
              onChange={(event) => setRiskInput(event.target.value)}
            />
            <span>%</span>
          </div>
        </label>
      </div>

      {!sizingValid && (
        <div className={shared.message} data-tone="error">
          {t('invalidSizing')}
        </div>
      )}
      {activeVenues.length === 0 && <div className={shared.message}>{ta('noSupportedVenues')}</div>}
      {query.isLoading && !data && sizingValid && (
        <div className={shared.message}>
          <Spinner size="sm" label={ta('scanningVenues', { n: activeVenues.length })} />
        </div>
      )}
      {query.error && (
        <div className={shared.message} data-tone="error">
          {data
            ? ta('refreshFailed', { time: new Date(data.generatedAt).toLocaleTimeString() })
            : ta('scannerUnavailable', {
                error: query.error instanceof Error ? query.error.message : ta('requestFailed'),
              })}
        </div>
      )}

      {data && sizingValid && (
        <>
          <CountsStrip data={data} refreshing={query.isFetching} />
          {!data.history.available && (
            <div className={shared.venueWarning}>{t('noHistory', { underlying })}</div>
          )}
          {unavailableVenues.length > 0 && (
            <div className={shared.venueWarning}>
              {ta('partialScanData', {
                venues: unavailableVenues
                  .map((status) => VENUES[status.venue]?.label ?? status.venue)
                  .join(', '),
              })}
            </div>
          )}
          <div className={shared.decisionStack}>
            {selected == null ? (
              <div className={shared.message}>{t('noFlies', { underlying })}</div>
            ) : (
              <>
                <FlyDetail
                  candidate={selected}
                  windows={data.windows.find((set) => set.expiryTs === selected.expiryTs) ?? null}
                  onOpenBuilder={openInBuilder}
                />
                <FlyTable
                  candidates={data.candidates}
                  selectedKey={flyKey(selected)}
                  onSelect={(candidate) => setSelectedKey(flyKey(candidate))}
                />
              </>
            )}
          </div>
        </>
      )}

      <footer className={shared.footer}>
        <span>{t('caveats')}</span>
      </footer>
    </section>
  );
}

function CountsStrip({ data, refreshing }: { data: AlphaIronFlyScannerResponse; refreshing: boolean }) {
  const t = useT(messages);
  const ta = useT(alphaMessages);
  const counts: Record<AlphaIronFlyVerdict, number> = {
    'historically-positive': 0,
    watch: 0,
    'historically-negative': 0,
    'thin-history': 0,
  };
  for (const candidate of data.candidates) counts[candidate.verdict] += 1;
  return (
    <div className={shared.marketStrip}>
      <span>
        {data.history.source.toUpperCase()}
        {data.history.firstCandleTs != null && (
          <>
            {' '}
            <strong>
              {new Date(data.history.firstCandleTs).toISOString().slice(0, 10)} →
            </strong>
          </>
        )}
      </span>
      <span className={shared.counts}>
        <strong data-verdict="historically-positive">
          {t('countPositive', { n: counts['historically-positive'] })}
        </strong>
        <strong data-verdict="watch">{ta('countWatch', { n: counts.watch })}</strong>
        <strong data-verdict="historically-negative">
          {t('countNegative', { n: counts['historically-negative'] })}
        </strong>
      </span>
      {refreshing && <span className={shared.refreshing}>{ta('refreshing')}</span>}
    </div>
  );
}

function FlyTable({
  candidates,
  selectedKey,
  onSelect,
}: {
  candidates: AlphaIronFlyCandidate[];
  selectedKey: string;
  onSelect: (candidate: AlphaIronFlyCandidate) => void;
}) {
  const t = useT(messages);
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>{t('expiry')}</th>
            <th>{t('venue')}</th>
            <th>{t('wings')}</th>
            <th>{t('credit')}</th>
            <th>{t('maxLoss')}</th>
            <th>{t('zone')}</th>
            <th>{t('histWin')}</th>
            <th>{t('impliedWin')}</th>
            <th>{t('fitMean')}</th>
            <th>{t('holdoutMean')}</th>
            <th>{t('worst')}</th>
            <th>{t('verdict')}</th>
          </tr>
        </thead>
        <tbody>
          {candidates.map((candidate) => {
            const key = flyKey(candidate);
            return (
              <tr
                key={key}
                data-selected={key === selectedKey}
                tabIndex={0}
                onClick={() => onSelect(candidate)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelect(candidate);
                  }
                }}
              >
                <td>
                  {formatExpiry(candidate.expiry)} <small>{candidate.dte.toFixed(1)}d</small>
                </td>
                <td>{VENUES[candidate.venue]?.label ?? candidate.venue}</td>
                <td>
                  {fmtStrike(candidate.center - candidate.width)}/{fmtStrike(candidate.center)}/
                  {fmtStrike(candidate.center + candidate.width)}
                </td>
                <td>{usd(candidate.netCredit)}</td>
                <td>{usd(candidate.maxLoss)}</td>
                <td>±{candidate.profitZonePct.toFixed(2)}%</td>
                <td>{rate(candidate.fit.profitRate)}</td>
                <td>{rate(candidate.impliedProfitRate)}</td>
                <td data-tone={tone(candidate.fit.meanPnl)}>{signedUsd(candidate.fit.meanPnl)}</td>
                <td data-tone={tone(candidate.holdout.meanPnl)}>
                  {signedUsd(candidate.holdout.meanPnl)}
                </td>
                <td>{signedUsd(candidate.all.worstPnl)}</td>
                <td>
                  <span className={styles.verdict} data-verdict={candidate.verdict}>
                    {t(candidate.verdict as keyof Messages)}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FlyDetail({
  candidate,
  windows,
  onOpenBuilder,
}: {
  candidate: AlphaIronFlyCandidate;
  windows: AlphaIronFlyWindowSet | null;
  onOpenBuilder: (candidate: AlphaIronFlyCandidate) => void;
}) {
  const t = useT(messages);
  const venueLabel = VENUES[candidate.venue]?.label ?? candidate.venue;
  const qty = candidate.suggestedQuantity;
  return (
    <article className={styles.detail}>
      <header className={styles.detailHeader}>
        <div>
          <div className={shared.venue}>
            {venueLabel} · {formatExpiry(candidate.expiry)} · {candidate.dte.toFixed(1)}d
          </div>
          <h3>
            {fmtStrike(candidate.center - candidate.width)} / {fmtStrike(candidate.center)} /{' '}
            {fmtStrike(candidate.center + candidate.width)}
          </h3>
          <p>
            {t('fees', {
              fees: usd(candidate.entryFees),
              credit: usd(candidate.netCredit),
              loss: usd(candidate.maxLoss),
              underlying: candidate.underlying,
            })}
          </p>
        </div>
        <span className={styles.verdict} data-verdict={candidate.verdict}>
          {t(candidate.verdict as keyof Messages)}
        </span>
      </header>

      <ul className={styles.legs} aria-label={t('legs')}>
        <li>
          {t('buy')} P {fmtStrike(candidate.center - candidate.width)} @ {usd(candidate.wingPutAsk)}
        </li>
        <li>
          {t('sell')} P {fmtStrike(candidate.center)} @ {usd(candidate.putBid)}
        </li>
        <li>
          {t('sell')} C {fmtStrike(candidate.center)} @ {usd(candidate.callBid)}
        </li>
        <li>
          {t('buy')} C {fmtStrike(candidate.center + candidate.width)} @ {usd(candidate.wingCallAsk)}
        </li>
        <li>
          {t('zone')} {fmtUsdCompact(candidate.breakevenLow)} – {fmtUsdCompact(candidate.breakevenHigh)}
        </li>
      </ul>

      <div className={styles.stats}>
        <StatColumn title={t('statFit', { n: candidate.fit.n })} stats={candidate.fit} showCi />
        <StatColumn
          title={t('statHoldout', { n: candidate.holdout.n })}
          stats={candidate.holdout}
          showCi={false}
        />
        <div>
          <span>{t('statImplied', { iv: fmtIv(candidate.markIv) })}</span>
          <dl>
            <dt>{t('profitRate')}</dt>
            <dd>{rate(candidate.impliedProfitRate)}</dd>
          </dl>
        </div>
        <div>
          <span>{t('atSize', { qty: qty > 0 ? qty : '–', underlying: candidate.underlying })}</span>
          <p>
            {qty > 0
              ? t('atSizeDetail', {
                  credit: usd(candidate.netCredit * qty),
                  loss: usd(candidate.maxLoss * qty),
                  mean: signedUsd(candidate.fit.meanPnl == null ? null : candidate.fit.meanPnl * qty),
                })
              : t('sizeZero')}
          </p>
        </div>
      </div>

      {windows != null && windows.ratios.length > 0 && (
        <SettlementHistogram candidate={candidate} windows={windows} />
      )}

      <div className={styles.flags}>
        <span>{t('flags')}</span>
        {candidate.flags.length === 0 ? (
          <p>{t('allClear')}</p>
        ) : (
          <ul>
            {candidate.flags.map((flag: AlphaIronFlyFlag) => (
              <li key={flag}>{t(`flag_${flag}` as keyof Messages)}</li>
            ))}
          </ul>
        )}
      </div>

      <button type="button" className={shared.builderButton} onClick={() => onOpenBuilder(candidate)}>
        {t('openInBuilder')}
      </button>
    </article>
  );
}

function StatColumn({
  title,
  stats,
  showCi,
}: {
  title: string;
  stats: AlphaIronFlyHistoryStats;
  showCi: boolean;
}) {
  const t = useT(messages);
  return (
    <div>
      <span>{title}</span>
      <dl>
        <dt>{t('profitRate')}</dt>
        <dd>{rate(stats.profitRate)}</dd>
        <dt>{t('meanPnl')}</dt>
        <dd data-tone={tone(stats.meanPnl)}>{signedUsd(stats.meanPnl)}</dd>
        <dt>{t('worstObserved')}</dt>
        <dd>{signedUsd(stats.worstPnl)}</dd>
      </dl>
      {showCi && stats.ciLow != null && stats.ciHigh != null && (
        <small>{t('ci', { low: signedUsd(stats.ciLow), high: signedUsd(stats.ciHigh) })}</small>
      )}
    </div>
  );
}

const CHART_W = 640;
const CHART_H = 150;
const PAD_X = 8;
const PAD_TOP = 10;
const PAD_BOTTOM = 22;

function SettlementHistogram({
  candidate,
  windows,
}: {
  candidate: AlphaIronFlyCandidate;
  windows: AlphaIronFlyWindowSet;
}) {
  const t = useT(messages);
  const { center, width, netCredit, forwardPrice } = candidate;
  const lo = center - 2.5 * width;
  const hi = center + 2.5 * width;
  const binWidth = (hi - lo) / HISTOGRAM_BINS;
  const bins = new Array<number>(HISTOGRAM_BINS).fill(0);
  for (const ratio of windows.ratios) {
    const settle = forwardPrice * ratio;
    const index = Math.min(HISTOGRAM_BINS - 1, Math.max(0, Math.floor((settle - lo) / binWidth)));
    bins[index]! += 1;
  }
  const maxCount = Math.max(1, ...bins);
  const plotH = CHART_H - PAD_TOP - PAD_BOTTOM;
  const x = (price: number) => PAD_X + ((price - lo) / (hi - lo)) * (CHART_W - 2 * PAD_X);
  const payoffY = (pnl: number) =>
    PAD_TOP + plotH / 2 - (pnl / Math.max(netCredit, width - netCredit)) * (plotH / 2) * 0.9;
  const payoff = [lo, center - width, center, center + width, hi]
    .map((price) => `${x(price)},${payoffY(netCredit - Math.min(Math.abs(price - center), width))}`)
    .join(' ');
  const barW = (CHART_W - 2 * PAD_X) / HISTOGRAM_BINS;
  const ticks = [center - width, center, center + width];

  return (
    <figure className={styles.chart}>
      <figcaption>{t('chartTitle', { n: windows.ratios.length })}</figcaption>
      <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} role="img" aria-label={t('chartAria')}>
        <rect
          className={styles.zone}
          x={x(candidate.breakevenLow)}
          y={PAD_TOP}
          width={x(candidate.breakevenHigh) - x(candidate.breakevenLow)}
          height={plotH}
        />
        {bins.map((count, index) => {
          if (count === 0) return null;
          const mid = lo + (index + 0.5) * binWidth;
          const inside = mid > candidate.breakevenLow && mid < candidate.breakevenHigh;
          const h = (count / maxCount) * plotH;
          return (
            <rect
              key={index}
              className={inside ? styles.barProfit : styles.barLoss}
              x={PAD_X + index * barW + 1}
              y={PAD_TOP + plotH - h}
              width={Math.max(1, barW - 2)}
              height={h}
            >
              <title>{`${fmtUsdCompact(lo + index * binWidth)}–${fmtUsdCompact(lo + (index + 1) * binWidth)}: ${count}`}</title>
            </rect>
          );
        })}
        <line className={styles.zeroLine} x1={PAD_X} x2={CHART_W - PAD_X} y1={payoffY(0)} y2={payoffY(0)} />
        <polyline className={styles.payoff} points={payoff} />
        <line
          className={styles.forward}
          x1={x(forwardPrice)}
          x2={x(forwardPrice)}
          y1={PAD_TOP}
          y2={PAD_TOP + plotH}
        />
        {ticks.map((tick) => (
          <text key={tick} x={x(tick)} y={CHART_H - 6} textAnchor="middle" className={styles.tick}>
            {fmtStrike(tick)}
          </text>
        ))}
      </svg>
    </figure>
  );
}
