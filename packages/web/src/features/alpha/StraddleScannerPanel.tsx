import { useDeferredValue, useState } from 'react';
import {
  VenueIdSchema,
  type AlphaStraddleCandidate,
  type AlphaStraddleScannerResponse,
  type AlphaStraddleVerdict,
  type VenueId,
} from '@oggregator/protocol';

import { Spinner } from '@components/ui';
import { useStrategyStore } from '@features/architect/strategy-store';
import { fmtIv } from '@lib/format';
import { defineMessages, useT } from '@lib/i18n';
import { VENUES } from '@lib/venue-meta';
import { useAppStore } from '@stores/app-store';

import { alphaMessages } from './i18n';
import { straddleToBuilderLegs } from './radar-builder';
import StraddleDecisionCard from './StraddleDecisionCard';
import StraddleVenueCards, { straddleKey } from './StraddleVenueCards';
import { useShortStraddleEvidence, useStraddleScanner } from './useStraddleScanner';
import styles from './StraddleScannerPanel.module.css';

const DTE_PRESETS = [
  { label: '1–7D', minDte: 1, maxDte: 7 },
  { label: '7–21D', minDte: 7, maxDte: 21 },
  { label: '21–45D', minDte: 21, maxDte: 45 },
  { label: '1–45D', minDte: 1, maxDte: 45 },
] as const;
const messages = defineMessages(
  {
    eyebrow: '{underlying} · {n} ACTIVE VENUES · SHORT ATM STRADDLES',
    title: 'Sell rich volatility, not cheap premium',
    description:
      'Sellable IV at the bids after fees, compared with a realized-vol forecast for the same horizon, the vol cone, and the usual insurance premium. A straddle has to clear all three gates before it can be a sell candidate.',
    stressTitle:
      "Tail move used for the stress loss and sizing, in forecast standard deviations over the option's life.",
    stressMove: 'Stress move',
    stressBudget: 'Stress budget',
    stressAria: 'Percent of equity allowed to be lost at the stress move',
    invalidSizing: 'Enter positive equity and a stress budget between 0 and 100%.',
    unboundedLoss:
      'Short straddles have unbounded loss. Stress loss is a scenario, not a maximum. No order is sent.',
    countSell: '{n} SELL',
    countCheap: '{n} CHEAP',
  },
  {
    eyebrow: '{underlying} · {n} EXCHANGES ACTIVOS · SHORT STRADDLES ATM',
    title: 'Vende volatilidad cara, no prima barata',
    description:
      'IV vendible en los bids después de comisiones, comparada con un pronóstico de vol realizada al mismo horizonte, el cono de vol y la prima de seguro habitual. Un straddle debe pasar los tres filtros antes de ser candidato a venta.',
    stressTitle:
      'Movimiento de cola usado para la pérdida de estrés y el dimensionamiento, en desviaciones estándar del pronóstico durante la vida de la opción.',
    stressMove: 'Movimiento de estrés',
    stressBudget: 'Presupuesto de estrés',
    stressAria: 'Porcentaje del capital que se permite perder en el movimiento de estrés',
    invalidSizing: 'Ingresa un capital positivo y un presupuesto de estrés entre 0 y 100%.',
    unboundedLoss:
      'Los short straddles tienen pérdida ilimitada. La pérdida de estrés es un escenario, no un máximo. No se envía ninguna orden.',
    countSell: '{n} VENDER',
    countCheap: '{n} BARATOS',
  },
);

const STRESS_PRESETS = [2, 3, 4] as const;
const MAX_SPREAD_PCT = 10;

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

interface StraddleScannerPanelProps {
  underlying: string;
  venues: string[];
}

export default function StraddleScannerPanel({ underlying, venues }: StraddleScannerPanelProps) {
  const t = useT(messages);
  const ta = useT(alphaMessages);
  const [dtePreset, setDtePreset] = useState(3);
  const [stressSigma, setStressSigma] = useState(3);
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

  const query = useStraddleScanner(
    {
      underlying,
      venues: activeVenues,
      minDte: dte.minDte,
      maxDte: dte.maxDte,
      equity: deferredEquity,
      riskPct: deferredRisk,
      stressSigma,
      maxSpreadPct: MAX_SPREAD_PCT,
      limit: 50,
    },
    activeVenues.length > 0 && sizingValid,
  );
  const evidence = useShortStraddleEvidence(underlying);
  const data = query.data;
  const selected =
    data?.candidates.find((candidate) => straddleKey(candidate) === selectedKey) ??
    data?.candidates[0] ??
    null;
  const unavailableVenues = data?.venueStatus.filter((status) => status.error != null) ?? [];

  function openInBuilder(candidate: AlphaStraddleCandidate): void {
    replaceLegs(straddleToBuilderLegs(candidate), candidate.underlying);
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
        <fieldset className={styles.controlGroup}>
          <legend title={t('stressTitle')}>{t('stressMove')}</legend>
          <div className={styles.presetRow}>
            {STRESS_PRESETS.map((value) => (
              <button
                type="button"
                key={value}
                data-active={stressSigma === value}
                aria-pressed={stressSigma === value}
                onClick={() => setStressSigma(value)}
              >
                {value}σ
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
          <span>{t('stressBudget')}</span>
          <div className={styles.inputShell}>
            <input
              inputMode="decimal"
              value={riskInput}
              aria-label={t('stressAria')}
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
            <StraddleDecisionCard
              candidate={selected}
              emptyState="quote"
              emptyReason={ta('noStraddlesInWindow', { underlying })}
              stressSigma={data.config.stressSigma}
              budgetUsd={(data.config.equity * data.config.riskPct) / 100}
              evidence={evidence.data ?? null}
              evidenceUnavailable={evidence.isError}
              onOpenBuilder={openInBuilder}
            />
            <StraddleVenueCards
              data={data}
              selectedKey={selected == null ? null : straddleKey(selected)}
              onSelect={(candidate) => setSelectedKey(straddleKey(candidate))}
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
        <span>{t('unboundedLoss')}</span>
      </footer>
    </section>
  );
}

function RegimeStrip({
  data,
  refreshing,
}: {
  data: AlphaStraddleScannerResponse;
  refreshing: boolean;
}) {
  const t = useT(messages);
  const ta = useT(alphaMessages);
  const counts: Record<AlphaStraddleVerdict, number> = {
    'sell-candidate': 0,
    watch: 0,
    cheap: 0,
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
        <strong data-verdict="sell-candidate">{t('countSell', { n: counts['sell-candidate'] })}</strong>
        <strong data-verdict="watch">{ta('countWatch', { n: counts.watch })}</strong>
        <strong data-verdict="cheap">{t('countCheap', { n: counts.cheap })}</strong>
      </span>
      {refreshing && <span className={styles.refreshing}>{ta('refreshing')}</span>}
    </div>
  );
}
