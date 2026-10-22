import { useDeferredValue, useState } from 'react';
import {
  VenueIdSchema,
  type AlphaLongStraddleCandidate,
  type AlphaLongStraddleScannerResponse,
  type AlphaLongStraddleVerdict,
  type VenueId,
} from '@oggregator/protocol';

import { Spinner } from '@components/ui';
import { useStrategyStore } from '@features/architect/strategy-store';
import { fmtIv } from '@lib/format';
import { defineMessages, useT } from '@lib/i18n';
import { VENUES } from '@lib/venue-meta';
import { useAppStore } from '@stores/app-store';

import { alphaMessages } from './i18n';
import LongStraddleDecisionCard from './LongStraddleDecisionCard';
import LongStraddleVenueCards, { longStraddleKey } from './LongStraddleVenueCards';
import { longStraddleToBuilderLegs } from './radar-builder';
import { useLongStraddleScanner } from './useStraddleScanner';
import styles from './StraddleScannerPanel.module.css';

const DTE_PRESETS = [
  { label: '1–7D', minDte: 1, maxDte: 7 },
  { label: '7–21D', minDte: 7, maxDte: 21 },
  { label: '21–45D', minDte: 21, maxDte: 45 },
  { label: '1–45D', minDte: 1, maxDte: 45 },
] as const;
const MAX_SPREAD_PCT = 10;

const messages = defineMessages(
  {
    eyebrow: '{underlying} · {n} ACTIVE VENUES · LONG ATM STRADDLES',
    title: 'Buy cheap volatility, when the forecast pays for it',
    description:
      'Buyable IV at the asks after fees, compared with the same realized-vol forecast the Sell Straddle tab uses, and the vol cone. A straddle has to be priced below the forecast by more than the fair band, and low on the cone, before it can be a buy candidate.',
    maxLossBudget: 'Max-loss budget',
    maxLossAria: 'Percent of equity that the debit may use',
    invalidSizing: 'Enter positive equity and a max-loss budget between 0 and 100%.',
    cappedLoss:
      'Loss is capped at the debit paid. Size is fitted to the budget, not a recommendation. No order is sent.',
    countBuy: '{n} BUY',
    countExpensive: '{n} EXPENSIVE',
  },
  {
    eyebrow: '{underlying} · {n} EXCHANGES ACTIVOS · LONG STRADDLES ATM',
    title: 'Compra volatilidad barata, cuando el pronóstico la paga',
    description:
      'IV comprable en los asks después de comisiones, comparada con el mismo pronóstico de vol realizada que usa la pestaña Vender straddle, y el cono de vol. Un straddle debe tener un precio por debajo del pronóstico por más de la banda justa, y estar bajo en el cono, antes de ser candidato a compra.',
    maxLossBudget: 'Presupuesto de pérdida máx.',
    maxLossAria: 'Porcentaje del capital que puede usar el débito',
    invalidSizing: 'Ingresa un capital positivo y un presupuesto de pérdida máx. entre 0 y 100%.',
    cappedLoss:
      'La pérdida está limitada al débito pagado. El tamaño se ajusta al presupuesto, no es una recomendación. No se envía ninguna orden.',
    countBuy: '{n} COMPRAR',
    countExpensive: '{n} CAROS',
  },
);

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

interface LongStraddlePanelProps {
  underlying: string;
  venues: string[];
}

export default function LongStraddlePanel({ underlying, venues }: LongStraddlePanelProps) {
  const t = useT(messages);
  const ta = useT(alphaMessages);
  const [dtePreset, setDtePreset] = useState(3);
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

  const query = useLongStraddleScanner(
    {
      underlying,
      venues: activeVenues,
      minDte: dte.minDte,
      maxDte: dte.maxDte,
      equity: deferredEquity,
      riskPct: deferredRisk,
      maxSpreadPct: MAX_SPREAD_PCT,
      limit: 50,
    },
    activeVenues.length > 0 && sizingValid,
  );
  const data = query.data;
  const selected =
    data?.candidates.find((candidate) => longStraddleKey(candidate) === selectedKey) ??
    data?.candidates[0] ??
    null;
  const unavailableVenues = data?.venueStatus.filter((status) => status.error != null) ?? [];

  function openInBuilder(candidate: AlphaLongStraddleCandidate): void {
    replaceLegs(longStraddleToBuilderLegs(candidate), candidate.underlying);
    setExpiry(candidate.expiry);
    setBuilderVariant('v2');
    setActiveTab('architect');
  }

  return (
    <section className={styles.panel}>
      <header className={styles.header}>
        <div>
          <div className={styles.eyebrow}>
            {t('eyebrow', { underlying, n: activeVenues.length })}
          </div>
          <h2 className={styles.title}>{t('title')}</h2>
          <p className={styles.description}>{t('description')}</p>
        </div>
        <span className={styles.scanOnly}>{ta('scanOnly')}</span>
      </header>

      <div className={styles.controls}>
        <fieldset className={styles.controlGroup}>
          <legend>{ta('expiryWindow')}</legend>
          <div className={styles.presetRow}>
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
        <label className={styles.inputControl} data-invalid={equity == null || undefined}>
          <span>{ta('equity')}</span>
          <div className={styles.inputShell}>
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
        <label className={styles.inputControl} data-invalid={riskPct == null || undefined}>
          <span>{t('maxLossBudget')}</span>
          <div className={styles.inputShell}>
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
        <div className={styles.fixedRules}>
          <span>{ta('atmStrikePerVenue')}</span>
          <span>{ta('maxStraddleSpread', { pct: MAX_SPREAD_PCT })}</span>
        </div>
      </div>

      {!sizingValid && (
        <div className={styles.message} data-tone="error">
          {t('invalidSizing')}
        </div>
      )}
      {activeVenues.length === 0 && (
        <div className={styles.message}>{ta('noSupportedVenues')}</div>
      )}
      {query.isLoading && !data && sizingValid && (
        <div className={styles.message}>
          <Spinner size="sm" label={ta('scanningVenues', { n: activeVenues.length })} />
        </div>
      )}
      {query.error && (
        <div className={styles.message} data-tone="error">
          {data
            ? ta('refreshFailed', { time: new Date(data.generatedAt).toLocaleTimeString() })
            : ta('scannerUnavailable', {
                error: query.error instanceof Error ? query.error.message : ta('requestFailed'),
              })}
        </div>
      )}

      {data && sizingValid && (
        <>
          <RegimeStrip data={data} refreshing={query.isFetching} />
          {unavailableVenues.length > 0 && (
            <div className={styles.venueWarning}>
              {ta('partialScanData', {
                venues: unavailableVenues
                  .map((status) => VENUES[status.venue]?.label ?? status.venue)
                  .join(', '),
              })}
            </div>
          )}
          <div className={styles.decisionStack}>
            <LongStraddleDecisionCard
              candidate={selected}
              emptyReason={ta('noStraddlesInWindow', { underlying })}
              budgetUsd={(data.config.equity * data.config.riskPct) / 100}
              onOpenBuilder={openInBuilder}
            />
            <LongStraddleVenueCards
              data={data}
              selectedKey={selected == null ? null : longStraddleKey(selected)}
              onSelect={(candidate) => setSelectedKey(longStraddleKey(candidate))}
            />
          </div>
        </>
      )}

      <footer className={styles.footer}>
        <span>
          {ta('forecastFooter', {
            longRun: data?.forecast.longRunDays || 180,
            halfLife: data?.forecast.halfLifeDays ?? 14,
          })}
        </span>
        <span>{t('cappedLoss')}</span>
      </footer>
    </section>
  );
}

function RegimeStrip({
  data,
  refreshing,
}: {
  data: AlphaLongStraddleScannerResponse;
  refreshing: boolean;
}) {
  const t = useT(messages);
  const ta = useT(alphaMessages);
  const counts: Record<AlphaLongStraddleVerdict, number> = {
    'buy-candidate': 0,
    watch: 0,
    expensive: 0,
    'no-forecast': 0,
  };
  for (const candidate of data.candidates) counts[candidate.verdict] += 1;
  return (
    <div className={styles.marketStrip}>
      <span>
        RV 7D / 30D{' '}
        <strong>
          {fmtIv(data.forecast.rv7d)} / {fmtIv(data.forecast.rv30d)}
        </strong>
      </span>
      <span>
        {ta('longRun')} <strong>{fmtIv(data.forecast.longRunVol)}</strong>
      </span>
      <span>
        ATM IV 7D / 30D{' '}
        <strong>
          {fmtIv(data.context.atmIv7d)} / {fmtIv(data.context.atmIv30d)}
        </strong>
      </span>
      <span>
        {ta('ivRank30d')}{' '}
        <strong>
          {data.context.ivPercentile30d == null
            ? '—'
            : `p${data.context.ivPercentile30d.toFixed(0)}`}
        </strong>
      </span>
      <span>
        {ta('term')} <strong>{data.context.termStructure.toUpperCase()}</strong>
      </span>
      <span>
        {ta('spotLabel')} <strong>{data.context.spotState.replaceAll('-', ' ').toUpperCase()}</strong>
      </span>
      <span className={styles.counts}>
        <strong data-verdict="buy-candidate">{t('countBuy', { n: counts['buy-candidate'] })}</strong>
        <strong data-verdict="watch">{ta('countWatch', { n: counts.watch })}</strong>
        <strong data-verdict="expensive">{t('countExpensive', { n: counts.expensive })}</strong>
      </span>
      {refreshing && <span className={styles.refreshing}>{ta('refreshing')}</span>}
    </div>
  );
}
