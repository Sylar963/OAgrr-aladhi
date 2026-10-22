import type { PortfolioCloseNow, PortfolioMetrics, PositionLeg } from '@oggregator/protocol';

import { defineMessages, useLocale, useT, type Translate } from '@lib/i18n';

import {
  closeNowMessages,
  coverageNote,
  fmtAge,
  giveBackLevel,
} from './close-now';
import { fmtNum, fmtUsdSigned } from './format';
import {
  calculateIvEdge,
  classifyBook,
  getParallelVolShock,
  getSpotShock,
  type BookMode,
} from './risk-profile';
import styles from './RiskCockpit.module.css';

interface Props {
  metrics: PortfolioMetrics | null;
  positions: PositionLeg[];
}

const messages = defineMessages(
  {
    flat_eyebrow: 'Waiting for a position',
    flat_label: 'NO OPEN RISK',
    flat_summary:
      'Add or connect a position to map the book into direction, volatility, convexity and carry.',
    flat_pressure: 'No active risk',
    long_vol_eyebrow: 'Optionality buyer',
    long_vol_label: 'LONG VOL',
    long_vol_summary:
      'You pay daily decay for convexity. The trade needs a large move, higher implied vol, or both.',
    long_vol_pressure: 'Main pressure: vol crush + theta',
    short_vol_eyebrow: 'Risk-premia seller',
    short_vol_label: 'SHORT VOL',
    short_vol_summary:
      'You collect daily decay while warehousing jump risk. A large move or vol expansion hurts.',
    short_vol_pressure: 'Main pressure: convexity + vol expansion',
    vega_neutral_eyebrow: 'Balanced volatility',
    vega_neutral_label: 'VEGA NEUTRAL',
    vega_neutral_summary:
      'Net vol exposure is close to flat. Direction, skew and convexity can still drive the book.',
    vega_neutral_pressure: 'Check delta + skew',
    flat: 'Flat',
    net_credit: 'net credit',
    net_debit: 'net debit',
    net_flat: 'net flat',
    closeNowPnl: 'Close-now P&L',
    booksOff: 'order books off',
    staleBook: 'stale · book {age} old',
    fees: 'fees {v}',
    exitCost: 'Exit cost',
    giveBack: 'Give-back',
    peak: 'peak {pnl} at {time}',
    peakMark: ' (mark {v})',
    takerClose: 'taker close on holding venue, after fees',
    cockpitAria: 'Portfolio risk cockpit',
    bookPosture: 'Book posture / {eyebrow}',
    unrealizedPnl: 'Unrealized P&L',
    markToEntry: 'mark to entry',
    ivEdge: 'IV edge',
    ivEdgeMissing: 'entry and live IV needed',
    exposure_long: 'long',
    exposure_short: 'short',
    exposure_mixed: 'mixed',
    ivEdgeFoot: '{exposure} · {entry} entry → {live} live',
    ledgerAria: 'Premium and venue ledger',
    premiumAria: 'Premium paid and received',
    premium: 'Premium',
    paid: 'Paid',
    received: 'Received',
    net: 'Net',
    openBook: 'Open book',
    legsOpen: 'legs still open',
    lifetime: 'Lifetime',
    noFillHistory: 'no fill history for this source',
    everyFill: 'every persisted fill, closed legs included',
    knownFees: 'Known fees',
    persistedFills: 'persisted venue fills',
    realizedPnl: 'Realized P&L',
    venueReported: 'venue-reported',
    fillsPersisted: '{n} venue fills persisted',
    snapshotPersisted: 'Position snapshot persisted; venue fill history pending',
    persistenceUnavailable: 'Venue fill persistence unavailable',
    notSynced: 'Not synced',
    synced: 'Synced {at}',
    direction: 'Direction',
    longDelta: 'Long delta',
    shortDelta: 'Short delta',
    deltaNote: 'Synthetic perp exposure right now.',
    volatility: 'Volatility',
    longVol: 'Long vol',
    shortVol: 'Short vol',
    vegaNote: 'P&L when implied vol rises 1 point.',
    convexity: 'Convexity',
    longConvexity: 'Long convexity',
    shortConvexity: 'Short convexity',
    gammaNote: 'How quickly your delta changes on a move.',
    dailyCarry: 'Daily carry',
    collectingDecay: 'Collecting decay',
    payingDecay: 'Paying decay',
    thetaNote: 'Funding-like time decay for one unchanged day.',
    translateRisk: 'Translate risk into P&L',
    secondaryGreeks: 'Skew / Vanna {vanna} · Vol convexity / Volga {volga}',
    spotDown: 'Spot -5%',
    spotUp: 'Spot +5%',
    deltaGamma: 'delta + gamma',
    ivDown: 'IV -5 vol',
    ivUp: 'IV +5 vol',
    volCrush: 'vol crush',
    volExpansion: 'vol expansion',
    hold1Day: 'Hold 1 day',
    thetaEstimate: 'theta estimate',
  },
  {
    flat_eyebrow: 'Esperando una posición',
    flat_label: 'SIN RIESGO ABIERTO',
    flat_summary:
      'Agrega o conecta una posición para mapear el libro en dirección, volatilidad, convexidad y carry.',
    flat_pressure: 'Sin riesgo activo',
    long_vol_eyebrow: 'Comprador de opcionalidad',
    long_vol_label: 'LONG VOL',
    long_vol_summary:
      'Pagas decaimiento diario a cambio de convexidad. El trade necesita un movimiento grande, mayor vol implícita, o ambos.',
    long_vol_pressure: 'Presión principal: caída de vol + theta',
    short_vol_eyebrow: 'Vendedor de prima de riesgo',
    short_vol_label: 'SHORT VOL',
    short_vol_summary:
      'Cobras decaimiento diario mientras asumes riesgo de salto. Un movimiento grande o una expansión de vol te perjudica.',
    short_vol_pressure: 'Presión principal: convexidad + expansión de vol',
    vega_neutral_eyebrow: 'Volatilidad equilibrada',
    vega_neutral_label: 'VEGA NEUTRAL',
    vega_neutral_summary:
      'La exposición neta a vol es casi plana. La dirección, el skew y la convexidad aún pueden mover el libro.',
    vega_neutral_pressure: 'Revisa delta + skew',
    flat: 'Plano',
    net_credit: 'crédito neto',
    net_debit: 'débito neto',
    net_flat: 'neto plano',
    closeNowPnl: 'P&L al cerrar ahora',
    booksOff: 'libros de órdenes desactivados',
    staleBook: 'desactualizado · libro de hace {age}',
    fees: 'comisiones {v}',
    exitCost: 'Costo de salida',
    giveBack: 'Devolución',
    peak: 'pico {pnl} a las {time}',
    peakMark: ' (mark {v})',
    takerClose: 'cierre taker en el exchange donde está, después de comisiones',
    cockpitAria: 'Cabina de riesgo del portafolio',
    bookPosture: 'Postura del libro / {eyebrow}',
    unrealizedPnl: 'P&L no realizado',
    markToEntry: 'mark vs entrada',
    ivEdge: 'Ventaja de IV',
    ivEdgeMissing: 'se necesita IV de entrada y en vivo',
    exposure_long: 'long',
    exposure_short: 'short',
    exposure_mixed: 'mixto',
    ivEdgeFoot: '{exposure} · {entry} entrada → {live} en vivo',
    ledgerAria: 'Registro de prima y exchange',
    premiumAria: 'Prima pagada y recibida',
    premium: 'Prima',
    paid: 'Pagado',
    received: 'Recibido',
    net: 'Neto',
    openBook: 'Libro abierto',
    legsOpen: 'legs aún abiertos',
    lifetime: 'Histórico',
    noFillHistory: 'sin historial de ejecuciones para esta fuente',
    everyFill: 'todas las ejecuciones guardadas, incluidos legs cerrados',
    knownFees: 'Comisiones conocidas',
    persistedFills: 'ejecuciones guardadas del exchange',
    realizedPnl: 'P&L realizado',
    venueReported: 'reportado por el exchange',
    fillsPersisted: '{n} ejecuciones del exchange guardadas',
    snapshotPersisted:
      'Snapshot de posiciones guardado; historial de ejecuciones del exchange pendiente',
    persistenceUnavailable: 'Guardado de ejecuciones del exchange no disponible',
    notSynced: 'Sin sincronizar',
    synced: 'Sincronizado {at}',
    direction: 'Dirección',
    longDelta: 'Long delta',
    shortDelta: 'Short delta',
    deltaNote: 'Exposición sintética a perpetuo en este momento.',
    volatility: 'Volatilidad',
    longVol: 'Long vol',
    shortVol: 'Short vol',
    vegaNote: 'P&L cuando la vol implícita sube 1 punto.',
    convexity: 'Convexidad',
    longConvexity: 'Long convexidad',
    shortConvexity: 'Short convexidad',
    gammaNote: 'Qué tan rápido cambia tu delta ante un movimiento.',
    dailyCarry: 'Carry diario',
    collectingDecay: 'Cobrando decaimiento',
    payingDecay: 'Pagando decaimiento',
    thetaNote: 'Decaimiento temporal tipo funding por un día sin cambios.',
    translateRisk: 'Traduce el riesgo a P&L',
    secondaryGreeks: 'Skew / Vanna {vanna} · Convexidad de vol / Volga {volga}',
    spotDown: 'Spot -5%',
    spotUp: 'Spot +5%',
    deltaGamma: 'delta + gamma',
    ivDown: 'IV -5 vol',
    ivUp: 'IV +5 vol',
    volCrush: 'caída de vol',
    volExpansion: 'expansión de vol',
    hold1Day: 'Mantener 1 día',
    thetaEstimate: 'estimación de theta',
  },
);

type T = Translate<typeof messages.en>;

interface ModeMeta {
  eyebrow: string;
  label: string;
  summary: string;
  pressure: string;
}

function modeMetaFor(mode: BookMode, t: T): ModeMeta {
  return {
    eyebrow: t(`${mode}_eyebrow`),
    label: t(`${mode}_label`),
    summary: t(`${mode}_summary`),
    pressure: t(`${mode}_pressure`),
  };
}

function fmtIv(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

function fmtVolPoints(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)} vol`;
}
function fmtUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `$${Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function fmtCashFlow(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  if (Math.abs(value) < 0.005) return '$0';
  return fmtUsdSigned(value);
}

function exposureSide(
  value: number | null | undefined,
  positive: string,
  negative: string,
  flat: string,
): string {
  if (value == null || Math.abs(value) < 1e-9) return flat;
  return value > 0 ? positive : negative;
}

interface PremiumRowProps {
  label: string;
  note: string;
  debitUsd: number | null;
  creditUsd: number | null;
}

// Cash-flow signs: premium paid is money out (−), premium received is money in (+).
function PremiumRow({ label, note, debitUsd, creditUsd }: PremiumRowProps) {
  const t = useT(messages);
  const net = debitUsd == null || creditUsd == null ? null : creditUsd - debitUsd;
  const netSide =
    net == null ? null : net > 0.005 ? 'credit' : net < -0.005 ? 'debit' : 'flat';
  return (
    <div className={styles.premiumRow} role="row">
      <span role="rowheader">
        {label}
        <small>{note}</small>
      </span>
      <strong role="cell">{fmtCashFlow(debitUsd == null ? null : -debitUsd)}</strong>
      <strong role="cell">{fmtCashFlow(creditUsd)}</strong>
      <strong
        role="cell"
        data-sign={netSide === 'credit' ? 'positive' : netSide === 'debit' ? 'negative' : undefined}
      >
        {fmtCashFlow(net)}
        {netSide != null && <small>{t(`net_${netSide}`)}</small>}
      </strong>
    </div>
  );
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function CloseNowMetric({ closeNow }: { closeNow: PortfolioCloseNow | null | undefined }) {
  const t = useT(messages);
  const tc = useT(closeNowMessages);
  const locale = useLocale();
  if (closeNow == null) {
    return (
      <div className={styles.closeNow} title={tc('tooltip')}>
        <span className={styles.metricLabel}>{t('closeNowPnl')}</span>
        <span className={styles.metricFoot}>{t('booksOff')}</span>
      </div>
    );
  }
  const total = closeNow.portfolio;
  const level = giveBackLevel(total.giveBackPct);
  const coverage = coverageNote(total, locale);
  const staleAge = total.stale
    ? Math.max(0, ...closeNow.legs.filter((l) => l.stale).map((l) => l.bookAgeMs ?? 0))
    : null;
  const foot = [
    staleAge != null ? t('staleBook', { age: fmtAge(staleAge) }) : null,
    coverage,
    total.feesUsd > 0 ? t('fees', { v: fmtUsdSigned(-total.feesUsd) }) : null,
  ].filter((part): part is string => part != null);
  return (
    <div
      className={styles.closeNow}
      data-stale={total.stale || undefined}
      title={`${tc('tooltip')}\n${tc('comboNote')}`}
    >
      <span className={styles.metricLabel}>{t('closeNowPnl')}</span>
      <div className={styles.closeNowRow}>
        <strong
          className={styles.closeNowValue}
          data-sign={(total.closeNowPnlUsd ?? 0) >= 0 ? 'positive' : 'negative'}
        >
          {fmtUsdSigned(total.closeNowPnlUsd)}
        </strong>
        <span className={styles.closeNowStat}>
          <small>{t('exitCost')}</small>
          {total.exitCostUsd == null ? '—' : fmtUsdSigned(-total.exitCostUsd)}
        </span>
        <span className={styles.closeNowStat} data-giveback={level ?? undefined}>
          <small>{t('giveBack')}</small>
          {total.giveBackPct == null ? '—' : `${total.giveBackPct.toFixed(0)}%`}
        </span>
      </div>
      {total.peak != null && (
        <span className={styles.metricFoot}>
          {t('peak', { pnl: fmtUsdSigned(total.peak.closeNowPnlUsd), time: fmtTime(total.peak.atMs) })}
          {total.peak.markPnlUsd != null ? t('peakMark', { v: fmtUsdSigned(total.peak.markPnlUsd) }) : ''}
        </span>
      )}
      <span className={styles.metricFoot}>
        {foot.length > 0 ? foot.join(' · ') : t('takerClose')}
      </span>
    </div>
  );
}

export default function RiskCockpit({ metrics, positions }: Props) {
  const t = useT(messages);
  const totals = metrics?.totals ?? null;
  const accounting = metrics?.accounting ?? null;
  const mode = classifyBook(totals, positions.length);
  const modeMeta = modeMetaFor(mode, t);
  const ivEdge = calculateIvEdge(positions, metrics?.breakEven ?? []);
  const spotDown = metrics == null ? null : getSpotShock(metrics.pnlCurve, -0.05);
  const spotUp = metrics == null ? null : getSpotShock(metrics.pnlCurve, 0.05);
  const volDown = getParallelVolShock(metrics?.shockGrid ?? [], -5);
  const volUp = getParallelVolShock(metrics?.shockGrid ?? [], 5);

  return (
    <section className={styles.cockpit} aria-label={t('cockpitAria')}>
      <div className={styles.posture} data-mode={mode}>
        <div className={styles.postureCopy}>
          <span className={styles.kicker}>{t('bookPosture', { eyebrow: modeMeta.eyebrow })}</span>
          <div className={styles.modeRow}>
            <h2 className={styles.mode}>{modeMeta.label}</h2>
            <span className={styles.pressure}>{modeMeta.pressure}</span>
          </div>
          <p className={styles.summary}>{modeMeta.summary}</p>
        </div>

        <div className={styles.headlineMetrics}>
          <div className={styles.headlineMetric}>
            <span className={styles.metricLabel}>{t('unrealizedPnl')}</span>
            <strong className={styles.pnl} data-sign={(totals?.unrealizedPnlUsd ?? 0) >= 0 ? 'positive' : 'negative'}>
              {fmtUsdSigned(totals?.unrealizedPnlUsd)}
            </strong>
            <span className={styles.metricFoot}>{t('markToEntry')}</span>
            <CloseNowMetric closeNow={metrics?.closeNow} />
          </div>
          <div className={styles.headlineMetric}>
            <span className={styles.metricLabel}>{t('ivEdge')}</span>
            <strong className={styles.ivEdge} data-sign={(ivEdge?.edgeVolPts ?? 0) >= 0 ? 'positive' : 'negative'}>
              {fmtVolPoints(ivEdge?.edgeVolPts)}
            </strong>
            <span className={styles.metricFoot}>
              {ivEdge == null
                ? t('ivEdgeMissing')
                : t('ivEdgeFoot', {
                    exposure: t(`exposure_${ivEdge.exposure}`),
                    entry: fmtIv(ivEdge.entryIv),
                    live: fmtIv(ivEdge.liveIv),
                  })}
            </span>
          </div>
        </div>
      </div>
      <div className={styles.accounting} aria-label={t('ledgerAria')}>
        <div className={styles.ledgerBody}>
          <div className={styles.premiumTable} role="table" aria-label={t('premiumAria')}>
            <div className={styles.premiumRow} role="row" data-head>
              <span role="columnheader">{t('premium')}</span>
              <span role="columnheader">{t('paid')}</span>
              <span role="columnheader">{t('received')}</span>
              <span role="columnheader">{t('net')}</span>
            </div>
            <PremiumRow
              label={t('openBook')}
              note={t('legsOpen')}
              debitUsd={accounting?.openGrossDebitUsd ?? null}
              creditUsd={accounting?.openGrossCreditUsd ?? null}
            />
            <PremiumRow
              label={t('lifetime')}
              note={
                accounting?.lifetimeGrossDebitUsd == null
                  ? t('noFillHistory')
                  : t('everyFill')
              }
              debitUsd={accounting?.lifetimeGrossDebitUsd ?? null}
              creditUsd={accounting?.lifetimeGrossCreditUsd ?? null}
            />
          </div>
          <div className={styles.accountingGrid}>
            <article className={styles.accountingCell}>
              <span>{t('knownFees')}</span>
              <strong>{fmtUsd(accounting?.knownFeesUsd)}</strong>
              <small>{t('persistedFills')}</small>
            </article>
            <article className={styles.accountingCell}>
              <span>{t('realizedPnl')}</span>
              <strong data-sign={(accounting?.realizedPnlUsd ?? 0) >= 0 ? 'positive' : 'negative'}>
                {fmtUsdSigned(accounting?.realizedPnlUsd)}
              </strong>
              <small>{t('venueReported')}</small>
            </article>
          </div>
        </div>
        <div className={styles.ledgerStatus} data-state={metrics?.accounting.persistence ?? 'unavailable'}>
          <span>
            {metrics?.accounting.persistence === 'venue_history'
              ? t('fillsPersisted', { n: metrics.accounting.persistedTradeCount ?? 0 })
              : metrics?.accounting.persistence === 'position_snapshot'
                ? t('snapshotPersisted')
                : t('persistenceUnavailable')}
          </span>
          <span>
            {metrics?.accounting.lastSyncedAtMs == null
              ? t('notSynced')
              : t('synced', { at: new Date(metrics.accounting.lastSyncedAtMs).toLocaleString() })}
          </span>
        </div>
      </div>


      <div className={styles.exposureGrid}>
        <article className={styles.exposureCard} data-accent="delta">
          <div className={styles.exposureHeader}>
            <span className={styles.exposureName}>{t('direction')}</span>
            <span className={styles.greek}>Delta</span>
          </div>
          <strong className={styles.exposureValue}>{fmtNum(totals?.netDeltaCoin)}</strong>
          <span className={styles.exposureState}>
            {exposureSide(totals?.netDeltaCoin, t('longDelta'), t('shortDelta'), t('flat'))}
          </span>
          <p>{t('deltaNote')}</p>
        </article>

        <article className={styles.exposureCard} data-accent="vega">
          <div className={styles.exposureHeader}>
            <span className={styles.exposureName}>{t('volatility')}</span>
            <span className={styles.greek}>Vega</span>
          </div>
          <strong className={styles.exposureValue}>{fmtUsdSigned(totals?.netVegaUsd)}</strong>
          <span className={styles.exposureState}>
            {exposureSide(totals?.netVegaUsd, t('longVol'), t('shortVol'), t('flat'))}
          </span>
          <p>{t('vegaNote')}</p>
        </article>

        <article className={styles.exposureCard} data-accent="gamma">
          <div className={styles.exposureHeader}>
            <span className={styles.exposureName}>{t('convexity')}</span>
            <span className={styles.greek}>Gamma</span>
          </div>
          <strong className={styles.exposureValue}>{fmtNum(totals?.netGammaUsd, 4)}</strong>
          <span className={styles.exposureState}>
            {exposureSide(totals?.netGammaUsd, t('longConvexity'), t('shortConvexity'), t('flat'))}
          </span>
          <p>{t('gammaNote')}</p>
        </article>

        <article className={styles.exposureCard} data-accent="theta">
          <div className={styles.exposureHeader}>
            <span className={styles.exposureName}>{t('dailyCarry')}</span>
            <span className={styles.greek}>Theta</span>
          </div>
          <strong className={styles.exposureValue}>{fmtUsdSigned(totals?.netThetaUsd)}</strong>
          <span className={styles.exposureState}>
            {exposureSide(totals?.netThetaUsd, t('collectingDecay'), t('payingDecay'), t('flat'))}
          </span>
          <p>{t('thetaNote')}</p>
        </article>
      </div>

      <div className={styles.stressSection}>
        <div className={styles.sectionLead}>
          <span className={styles.kicker}>{t('translateRisk')}</span>
          <span className={styles.secondaryGreeks}>
            {t('secondaryGreeks', {
              vanna: fmtNum(totals?.netVannaUsd, 4),
              volga: fmtNum(totals?.netVolgaUsd, 4),
            })}
          </span>
        </div>
        <div className={styles.stressGrid}>
          <div className={styles.stressCard}>
            <span>{t('spotDown')}</span>
            <strong data-sign={(spotDown ?? 0) >= 0 ? 'positive' : 'negative'}>{fmtUsdSigned(spotDown)}</strong>
            <small>{t('deltaGamma')}</small>
          </div>
          <div className={styles.stressCard}>
            <span>{t('spotUp')}</span>
            <strong data-sign={(spotUp ?? 0) >= 0 ? 'positive' : 'negative'}>{fmtUsdSigned(spotUp)}</strong>
            <small>{t('deltaGamma')}</small>
          </div>
          <div className={styles.stressCard}>
            <span>{t('ivDown')}</span>
            <strong data-sign={(volDown ?? 0) >= 0 ? 'positive' : 'negative'}>{fmtUsdSigned(volDown)}</strong>
            <small>{t('volCrush')}</small>
          </div>
          <div className={styles.stressCard}>
            <span>{t('ivUp')}</span>
            <strong data-sign={(volUp ?? 0) >= 0 ? 'positive' : 'negative'}>{fmtUsdSigned(volUp)}</strong>
            <small>{t('volExpansion')}</small>
          </div>
          <div className={styles.stressCard}>
            <span>{t('hold1Day')}</span>
            <strong data-sign={(totals?.netThetaUsd ?? 0) >= 0 ? 'positive' : 'negative'}>
              {fmtUsdSigned(totals?.netThetaUsd)}
            </strong>
            <small>{t('thetaEstimate')}</small>
          </div>
        </div>
      </div>
    </section>
  );
}
