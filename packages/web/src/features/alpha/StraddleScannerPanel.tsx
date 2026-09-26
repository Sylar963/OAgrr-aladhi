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
import { VENUES } from '@lib/venue-meta';
import { useAppStore } from '@stores/app-store';

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
            {underlying} · {activeVenues.length} ACTIVE VENUES · SHORT ATM STRADDLES
          </div>
          <h2 className={styles.title}>Sell rich volatility, not cheap premium</h2>
          <p className={styles.description}>
            Sellable IV at the bids after fees, compared with a realized-vol forecast for the
            same horizon, the vol cone, and the usual insurance premium. A straddle has to clear
            all three gates before it can be a sell candidate.
          </p>
        </div>
        <span className={styles.scanOnly}>SCAN ONLY</span>
      </header>

      <div className={styles.controls}>
        <fieldset className={styles.controlGroup}>
          <legend>Expiry window</legend>
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
          <legend title="Tail move used for the stress loss and sizing, in forecast standard deviations over the option's life.">
            Stress move
          </legend>
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
          <span>Equity</span>
          <div className={styles.inputShell}>
            <span>$</span>
            <input
              inputMode="decimal"
              value={equityInput}
              aria-label="Account equity for straddle sizing"
              aria-invalid={equity == null}
              onChange={(event) => setEquityInput(event.target.value)}
            />
          </div>
        </label>
        <label className={styles.inputControl} data-invalid={riskPct == null || undefined}>
          <span>Stress budget</span>
          <div className={styles.inputShell}>
            <input
              inputMode="decimal"
              value={riskInput}
              aria-label="Percent of equity allowed to be lost at the stress move"
              aria-invalid={riskPct == null}
              onChange={(event) => setRiskInput(event.target.value)}
            />
            <span>%</span>
          </div>
        </label>
        <div className={styles.fixedRules}>
          <span>ATM strike per venue/expiry</span>
          <span>≤{MAX_SPREAD_PCT}% straddle spread</span>
        </div>
      </div>

      {!sizingValid && (
        <div className={styles.message} data-tone="error">
          Enter positive equity and a stress budget between 0 and 100%.
        </div>
      )}
      {activeVenues.length === 0 && (
        <div className={styles.message}>No supported active venues are available for this scan.</div>
      )}
      {query.isLoading && !data && sizingValid && (
        <div className={styles.message}>
          <Spinner size="sm" label={`Scanning ${activeVenues.length} venues…`} />
        </div>
      )}
      {query.error && (
        <div className={styles.message} data-tone="error">
          {data
            ? `Refresh failed; showing the scan from ${new Date(data.generatedAt).toLocaleTimeString()}.`
            : `Scanner unavailable: ${query.error instanceof Error ? query.error.message : 'request failed'}`}
        </div>
      )}

      {data && sizingValid && (
        <>
          <RegimeStrip data={data} refreshing={query.isFetching} />
          {unavailableVenues.length > 0 && (
            <div className={styles.venueWarning}>
              Partial or no scan data from{' '}
              {unavailableVenues.map((status) => VENUES[status.venue]?.label ?? status.venue).join(', ')}.
            </div>
          )}
          <div className={styles.decisionStack}>
            <StraddleDecisionCard
              candidate={selected}
              emptyState="quote"
              emptyReason={`No executable ${underlying} ATM straddles in this window. Check spreads, fees, and quote freshness, or widen the expiry window.`}
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
          The forecast decays 7D realized vol toward the {data?.forecast.longRunDays || 180}D level
          with a {data?.forecast.halfLifeDays ?? 14}-day half-life. That half-life is an assumption
          not fitted to BTC, and the forecast is not an event model.
        </span>
        <span>
          Short straddles have unbounded loss. Stress loss is a scenario, not a maximum. No order is
          sent.
        </span>
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
        LONG-RUN <strong>{fmtIv(data.forecast.longRunVol)}</strong>
      </span>
      <span>
        ATM IV 7D / 30D{' '}
        <strong>
          {fmtIv(data.context.atmIv7d)} / {fmtIv(data.context.atmIv30d)}
        </strong>
      </span>
      <span>
        IV RANK 30D{' '}
        <strong>
          {data.context.ivPercentile30d == null
            ? '—'
            : `p${data.context.ivPercentile30d.toFixed(0)}`}
        </strong>
      </span>
      <span>
        TERM <strong>{data.context.termStructure.toUpperCase()}</strong>
      </span>
      <span>
        SPOT <strong>{data.context.spotState.replaceAll('-', ' ').toUpperCase()}</strong>
      </span>
      <span className={styles.counts}>
        <strong data-verdict="sell-candidate">{counts['sell-candidate']} SELL</strong>
        <strong data-verdict="watch">{counts.watch} WATCH</strong>
        <strong data-verdict="cheap">{counts.cheap} CHEAP</strong>
      </span>
      {refreshing && <span className={styles.refreshing}>REFRESHING</span>}
    </div>
  );
}
