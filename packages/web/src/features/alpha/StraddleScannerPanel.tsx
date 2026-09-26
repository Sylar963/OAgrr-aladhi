import { useDeferredValue, useState } from 'react';
import {
  VenueIdSchema,
  type AlphaStraddleCandidate,
  type AlphaStraddleFlag,
  type AlphaStraddleScannerResponse,
  type AlphaStraddleVerdict,
  type ShortStraddleEvaluationResponse,
  type VenueId,
} from '@oggregator/protocol';

import { Spinner } from '@components/ui';
import { useStrategyStore } from '@features/architect/strategy-store';
import { fmtIv, fmtPct, fmtUsd, fmtUsdCompact, formatExpiry } from '@lib/format';
import { VENUES } from '@lib/venue-meta';
import { useAppStore } from '@stores/app-store';

import { straddleToBuilderLegs } from './radar-builder';
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

const VERDICT_LABEL: Record<AlphaStraddleVerdict, string> = {
  'sell-candidate': 'SELL CANDIDATE',
  watch: 'WATCH',
  cheap: "CHEAP · DON'T SELL",
  'no-forecast': 'NO FORECAST',
};

const FLAG_TEXT: Record<AlphaStraddleFlag, string> = {
  iv_below_hurdle:
    'Sellable IV (bids, after fees) is not above the higher of the forecast and matched-horizon realized vol. Edge is implied minus future realized (Sinclair p. 87).',
  negative_model_edge:
    'Net credit is below the straddle’s value at the forecast vol, so the model expects to pay out more than it collects.',
  below_cone_median:
    'Sellable IV is below the median realized vol for this horizon. That is cheap versus the vol cone (Sinclair pp. 39–41).',
  below_cone_p75:
    'Sellable IV is below the 75th percentile of the vol cone. It is not historically rich for this horizon.',
  cone_unavailable: 'Not enough spot history to build the vol cone for this horizon.',
  premium_not_above_normal:
    'IV minus forecast is not above the usual implied-minus-subsequent-realized spread. That is ordinary insurance premium, which Sinclair (pp. 41–43) says is not a good enough reason to sell.',
  premium_baseline_unknown:
    'Too little IV history to measure the usual premium for this tenor. It is treated as unknown, not zero.',
  term_backwardation:
    'Front IV is above 30D IV. Turbulent regime: rich vol can be rich for a reason (Sinclair pp. 15–16; Bennett pp. 138–139).',
  spot_breaking_out: 'Spot is outside its 20-day range. Realized vol may be about to re-rate.',
  realized_accelerating: '7D realized vol is more than 1.25× the 30D level. The recent move may not be over.',
  gamma_window: 'Under two days to expiry. Gamma dominates and small moves swing P&L sharply.',
  size_below_minimum:
    'The risk budget or top-of-book size cannot cover the venue minimum at this stress level.',
  forecast_unavailable: 'No realized-vol forecast is available, so premium cannot be judged.',
};

function scannerVenues(venues: string[]): VenueId[] {
  return venues.flatMap((venue) => {
    const parsed = VenueIdSchema.safeParse(venue);
    return parsed.success ? [parsed.data] : [];
  });
}

function candidateKey(candidate: AlphaStraddleCandidate): string {
  return `${candidate.venue}:${candidate.expiry}:${candidate.strike}`;
}

function volPts(value: number | null): string {
  if (value == null) return '—';
  const pts = value * 100;
  return `${pts > 0 ? '+' : ''}${pts.toFixed(1)}pt`;
}

function fmtQty(value: number): string {
  return value === 0 ? '0' : value.toFixed(value >= 1 ? 2 : 3).replace(/\.?0+$/, '');
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
      limit: 30,
    },
    activeVenues.length > 0 && sizingValid,
  );
  const evidence = useShortStraddleEvidence(underlying);
  const data = query.data;
  const selected =
    data?.candidates.find((candidate) => candidateKey(candidate) === selectedKey) ??
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
          {data.candidates.length === 0 ? (
            <div className={styles.message}>
              No executable {underlying} ATM straddles in this window. Check spreads, fees, and
              quote freshness.
            </div>
          ) : (
            <div className={styles.results}>
              <div className={styles.tableScroll}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Venue / expiry</th>
                      <th title="Call bid + put bid minus taker fees, per 1 underlying.">Net credit</th>
                      <th title="Vol implied by the net credit versus the higher of forecast and matched realized vol.">Sell IV / hurdle</th>
                      <th title="Where sellable IV sits among historical realized vols of the same horizon.">Cone</th>
                      <th title="IV minus forecast, less the usual implied-minus-subsequent-realized spread.">Excess</th>
                      <th title="Net credit minus Black-76 value at forecast vol, per 1 underlying.">Model edge</th>
                      <th title="Quantity where the stress loss fits the budget, capped by top-of-book.">Size</th>
                      <th>Verdict</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.candidates.map((candidate) => {
                      const key = candidateKey(candidate);
                      return (
                        <tr
                          key={key}
                          data-selected={selected != null && candidateKey(selected) === key}
                          tabIndex={0}
                          onClick={() => setSelectedKey(key)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              setSelectedKey(key);
                            }
                          }}
                        >
                          <td>
                            <span className={styles.venue}>
                              {VENUES[candidate.venue]?.label ?? candidate.venue}
                            </span>
                            <strong>{formatExpiry(candidate.expiry)}</strong>
                            <small>
                              {candidate.dte.toFixed(1)}D · K {candidate.strike.toLocaleString()}
                            </small>
                          </td>
                          <td>
                            <strong>{fmtUsd(candidate.netCredit)}</strong>
                            <small>±{fmtPct(candidate.breakevenMovePct, 1)} BE</small>
                          </td>
                          <td>
                            <strong>{fmtIv(candidate.sellIv)}</strong>
                            <small>
                              vs {fmtIv(candidate.hurdleVol)} · {volPts(candidate.volEdge)}
                            </small>
                          </td>
                          <td>
                            <strong>
                              {candidate.conePercentile == null
                                ? '—'
                                : `p${candidate.conePercentile.toFixed(0)}`}
                            </strong>
                          </td>
                          <td>
                            <strong>{volPts(candidate.excessEdge)}</strong>
                          </td>
                          <td>
                            <strong data-sign={Math.sign(candidate.modelEdgeUsd ?? 0)}>
                              {fmtUsd(candidate.modelEdgeUsd)}
                            </strong>
                          </td>
                          <td>
                            <strong>{fmtQty(candidate.suggestedQuantity)}</strong>
                            <small>min {fmtQty(candidate.minQuantity)}</small>
                          </td>
                          <td>
                            <span className={styles.verdict} data-verdict={candidate.verdict}>
                              {VERDICT_LABEL[candidate.verdict]}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {selected && (
                <StraddleInspector
                  candidate={selected}
                  stressSigma={data.config.stressSigma}
                  budgetUsd={(data.config.equity * data.config.riskPct) / 100}
                  evidence={evidence.data ?? null}
                  evidenceUnavailable={evidence.isError}
                  onOpenBuilder={openInBuilder}
                />
              )}
            </div>
          )}
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

interface StraddleInspectorProps {
  candidate: AlphaStraddleCandidate;
  stressSigma: number;
  budgetUsd: number;
  evidence: ShortStraddleEvaluationResponse | null;
  evidenceUnavailable: boolean;
  onOpenBuilder: (candidate: AlphaStraddleCandidate) => void;
}

function StraddleInspector({
  candidate,
  stressSigma,
  budgetUsd,
  evidence,
  evidenceUnavailable,
  onOpenBuilder,
}: StraddleInspectorProps) {
  const segments = evidence?.segments.filter((segment) => segment.venue === candidate.venue) ?? [];
  const quantity = candidate.suggestedQuantity;
  return (
    <aside className={styles.inspector}>
      <div className={styles.inspectorHeader}>
        <span className={styles.venue}>{VENUES[candidate.venue]?.label ?? candidate.venue}</span>
        <strong>
          SELL {candidate.strike.toLocaleString()} STRADDLE · {formatExpiry(candidate.expiry)}
        </strong>
        <span className={styles.verdict} data-verdict={candidate.verdict}>
          {VERDICT_LABEL[candidate.verdict]}
        </span>
      </div>

      {candidate.flags.length === 0 ? (
        <p className={styles.passNote}>
          It clears all three gates: IV above the matched forecast, at least p75 on the vol cone,
          and above the usual premium. That supports a sell, but it is not proof of an edge.
          Record the thesis before trading.
        </p>
      ) : (
        <ul className={styles.flagList}>
          {candidate.flags.map((flag) => (
            <li key={flag}>{FLAG_TEXT[flag]}</li>
          ))}
        </ul>
      )}

      <dl className={styles.facts}>
        <div>
          <dt>Credit</dt>
          <dd>
            {fmtUsd(candidate.grossCredit)} − {fmtUsd(candidate.entryFees)} fees ={' '}
            <strong>{fmtUsd(candidate.netCredit)}</strong> / {candidate.underlying}
          </dd>
        </div>
        <div>
          <dt>Breakevens</dt>
          <dd>
            {fmtUsdCompact(candidate.breakevenLow)} – {fmtUsdCompact(candidate.breakevenHigh)}
          </dd>
        </div>
        <div>
          <dt title="Daily move at which gamma losses equal theta income at the selling IV.">
            Daily BE move
          </dt>
          <dd>
            {fmtPct(candidate.dailyBreakevenMovePct, 2)} vs forecast{' '}
            {fmtPct(candidate.forecastDailyMovePct, 2)}
          </dd>
        </div>
        <div>
          <dt title="Lognormal probability at forecast vol. A model estimate, not a win rate.">
            Inside BE (model)
          </dt>
          <dd>
            {candidate.probInsideAtForecast == null
              ? '—'
              : fmtPct(candidate.probInsideAtForecast * 100, 0)}
          </dd>
        </div>
        <div>
          <dt>Vol</dt>
          <dd>
            sell {fmtIv(candidate.sellIv)} · mark {fmtIv(candidate.markIv)} · forecast{' '}
            {fmtIv(candidate.forecastVol)} · realized {fmtIv(candidate.realizedMatchedVol)}
          </dd>
        </div>
        <div>
          <dt>Usual premium</dt>
          <dd>
            {candidate.premiumBaseline.medianSpread == null
              ? `unknown (${candidate.premiumBaseline.independentSampleCount} independent ${candidate.premiumBaseline.tenorDays}D windows)`
              : `${volPts(candidate.premiumBaseline.medianSpread)} median over ${candidate.premiumBaseline.independentSampleCount} independent ${candidate.premiumBaseline.tenorDays}D windows`}
          </dd>
        </div>
        <div>
          <dt>{stressSigma}σ stress</dt>
          <dd>
            ±{fmtPct(candidate.stressMovePct, 1)} → −{fmtUsd(candidate.stressLossUsd)} /{' '}
            {candidate.underlying}
          </dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd>
            {fmtQty(quantity)} {candidate.underlying} → −{fmtUsd(quantity * candidate.stressLossUsd)}{' '}
            at stress of {fmtUsd(budgetUsd)} budget · book {fmtQty(candidate.topOfBookQuantity)}
          </dd>
        </div>
        <div>
          <dt>Net delta</dt>
          <dd>{candidate.netDelta == null ? '—' : candidate.netDelta.toFixed(3)} / unit</dd>
        </div>
      </dl>

      <div className={styles.evidence}>
        <span>WALK-FORWARD EVIDENCE · ATM ~7D · BIDS IN, ASKS OUT, FEES</span>
        {evidenceUnavailable ? (
          <small>Evidence collection is unavailable on this server.</small>
        ) : evidence == null ? (
          <small>Loading…</small>
        ) : segments.length === 0 ? (
          <small>
            {evidence.status === 'collecting' ? 'Collecting' : 'No completed'} samples for this
            venue yet. Nothing here validates an edge.
          </small>
        ) : (
          <div className={styles.evidenceGrid}>
            {segments.map((segment) => (
              <div key={segment.horizonHours} data-assessment={segment.assessment}>
                <span>{segment.horizonHours}H</span>
                <strong>{fmtUsd(segment.meanPnlUsdPerUnit)}</strong>
                <small>
                  n={segment.independentSampleCount} ·{' '}
                  {segment.assessment.replaceAll('_', ' ')}
                </small>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className={styles.bookNote}>
        Premium concentrates near the strike. That is an argument for strangles when you want to
        keep the short-vol view but survive more moves (Sinclair p. 97). Being right on vol can
        still lose on the path (pp. 92–93), so size below full Kelly (p. 109).
      </p>

      <button type="button" className={styles.builderButton} onClick={() => onOpenBuilder(candidate)}>
        <span>Open both legs in Builder V2</span>
        <span aria-hidden="true">↗</span>
      </button>
    </aside>
  );
}
