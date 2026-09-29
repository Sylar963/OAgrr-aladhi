import { useDeferredValue, useState } from 'react';
import {
  VenueIdSchema,
  type AlphaPutCandidate,
  type AlphaPutRankBy,
  type AlphaPutScannerResponse,
  type AlphaPutTarget,
  type VenueId,
} from '@oggregator/protocol';

import { Spinner } from '@components/ui';
import HoverTooltip from '@components/ui/HoverTooltip';
import { useStrategyStore } from '@features/architect/strategy-store';
import { fmtDelta, fmtIv, fmtPct, fmtUsd, fmtUsdCompact, formatExpiry } from '@lib/format';
import { VENUES } from '@lib/venue-meta';
import { useAppStore } from '@stores/app-store';

import { buildProtectionChoices, hedgedPnlAt, type ProtectionChoice, type ProtectionStyle } from './put-protection';
import { putCandidateToBuilderLeg } from './radar-builder';
import { usePutScanner } from './usePutScanner';
import styles from './LottoScannerPanel.module.css';
import ob from './LottoOutcomeBuilder.module.css';
import own from './ProtectivePutPanel.module.css';

const PREMIUM_PRESETS = [250, 500, 1_000, 2_500] as const;
const OTM_PRESETS = [0, 5, 10, 15] as const;
const FLOOR_PRESETS = [10, 20, 30] as const;
const GUIDED_MIN_DTE = 7;
const GUIDED_MAX_DTE = 90;
const ADVANCED_MIN_DTE = 4;
const ADVANCED_MAX_DTE = 60;
const STRESS_MOVE_PCT = -30;
type ScannerView = 'guided' | 'advanced';

const CARD_STYLE: Record<ProtectionStyle, { order: string; label: string; character: string; tone: string }> = {
  tight: { order: '01', label: 'Tight floor', character: 'Smallest worst case', tone: 'safer' },
  balanced: { order: '02', label: 'Balanced', character: 'Middle strike', tone: 'balanced' },
  cheap: { order: '03', label: 'Crash cover', character: 'Cheapest premium', tone: 'moonshot' },
};

const CONTROL_TIPS = {
  mark: 'The sticker price used to filter the board. Your real buy-in is the ask, which can be higher.',
  otm: 'How far the market must fall just to touch the strike. Farther out is cheaper, but pays only in a deeper drop.',
  rank: 'Protection ranks by worst-case hedged loss. Convexity ranks by the drop needed for a 5× mark.',
  bankroll: 'Premium budget for outright long puts. The scanner shows what fits; it never places an order.',
} as const;

const COLUMN_TIPS = {
  price: 'MARK is the table estimate. ASK is the quoted price before taker fees.',
  volatility: 'Put IV and its premium over the ATM IV of the same expiry. Downside puts usually carry positive skew.',
  breakeven: 'OTM is the fall to the strike. BE is the fall needed for the put alone to pay back its fee-adjusted ask.',
  target: 'A model of the fall that could make the put worth 5× your ask-paid entry. It is not a probability or guarantee.',
  insurance: 'Premium as a percent of one unit of underlying, and that cost annualized so expiries compare fairly.',
  capacity: 'Contracts your budget covers at fee-adjusted ask, capped by quoted ask size. Reserved also uses a safety buffer.',
} as const;

interface ProtectivePutPanelProps {
  underlying: string;
  venues: string[];
}

function pct(value: number | null | undefined, decimals = 1): string {
  return value == null ? '–' : `${value.toFixed(decimals)}%`;
}

function signedUsd(value: number): string {
  const text = fmtUsdCompact(Math.abs(value));
  return value < 0 ? `−${text}` : `+${text}`;
}

function skewPoints(value: number | null): string {
  if (value == null) return '—';
  const points = value * 100;
  return `${points >= 0 ? '+' : ''}${points.toFixed(1)} vs ATM`;
}

function targetFor(candidate: AlphaPutCandidate, multiple: number): AlphaPutTarget | null {
  return candidate.targets.find((target) => target.multiple === multiple) ?? null;
}

function scannerVenues(venues: string[]): VenueId[] {
  return venues.flatMap((venue) => {
    const parsed = VenueIdSchema.safeParse(venue);
    return parsed.success ? [parsed.data] : [];
  });
}

function formatQuantity(value: number): string {
  return value >= 100 ? value.toFixed(0) : value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function validQty(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 100_000 ? parsed : null;
}

function csvCell(value: string | number | boolean | null): string {
  if (value == null) return '';
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function downloadCsv(data: AlphaPutScannerResponse): void {
  const headers = [
    'venue', 'underlying', 'instrument', 'expiry', 'dte', 'strike', 'contract_size', 'min_qty',
    'inverse', 'mark_usd', 'bid_usd', 'ask_usd', 'taker_fee_usd', 'entry_cost_usd', 'mark_iv',
    'atm_iv', 'skew_premium', 'otm_pct', 'expiry_be_pct', 'cost_pct', 'annualized_cost_pct',
    'hedged_max_loss_pct', 'quantity_at_ask', 'move_5x_pct', 'implied_moves_5x',
  ];
  const rows = data.candidates.map((candidate) => {
    const fiveX = targetFor(candidate, 5);
    return [
      candidate.venue, candidate.underlying, candidate.instrument, candidate.expiry, candidate.dte,
      candidate.strike, candidate.contractSize, candidate.minQty, candidate.inverse, candidate.mark,
      candidate.bid, candidate.ask, candidate.takerFee, candidate.entryCost, candidate.markIv,
      candidate.atmIv, candidate.protection.skewPremium, candidate.otmPct, candidate.breakEvenMovePct,
      candidate.protection.costPct, candidate.protection.annualizedCostPct,
      candidate.protection.maxLossPct, candidate.quantityAtAsk, fiveX?.modelMovePct ?? null,
      fiveX?.impliedMoveMultiple ?? null,
    ];
  });
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${data.underlying.toLowerCase()}-long-put-scan-${new Date(data.generatedAt).toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function MetricTip({ label, tip, placement = 'bottom-start' }: {
  label: string;
  tip: string;
  placement?: 'bottom-start' | 'bottom-end';
}) {
  return (
    <HoverTooltip
      className={styles.tipTrigger}
      placement={placement}
      content={<div className={styles.metricTip}>{tip}</div>}
    >
      <span>{label}</span>
      <span className={styles.tipMark} aria-hidden="true">?</span>
    </HoverTooltip>
  );
}

function PutBetTooltip({ candidate }: { candidate: AlphaPutCandidate }) {
  const expiry = formatExpiry(candidate.expiry);
  return (
    <div className={styles.betTooltip}>
      <div className={styles.betTooltipHeader}>
        <span>THE HAND · LONG PUT</span>
        <strong>{candidate.underlying} DOWN BEFORE {expiry.toUpperCase()}</strong>
      </div>
      <p>
        Bought alone, this is a capped-cost bet on a fall. Held against {candidate.underlying} you own,
        it is insurance: it sets a floor at the strike for the life of the option.
      </p>
      <div className={styles.betLines}>
        <div data-tone="stake">
          <span>BUY-IN</span>
          <strong>{fmtUsd(candidate.entryCost)} estimated entry</strong>
          <small>
            {candidate.takerFee == null
              ? `${fmtUsd(candidate.ask)} ask; fee unavailable and excluded.`
              : `${fmtUsd(candidate.ask)} ask + ${fmtUsd(candidate.takerFee)} taker fee.`}
          </small>
        </div>
        <div data-tone="win">
          <span>AS A BET · PROFIT BELOW</span>
          <strong>{fmtUsdCompact(candidate.breakEvenPrice)}</strong>
          <small>That is a {fmtPct(candidate.breakEvenMovePct, 1)} fall from now.</small>
        </div>
        <div data-tone="bust">
          <span>AS A HEDGE · FLOOR</span>
          <strong>{fmtUsdCompact(candidate.strike)} · worst case {pct(candidate.protection.maxLossPct)}</strong>
          <small>
            Costs {pct(candidate.protection.costPct, 2)} of spot ({pct(candidate.protection.annualizedCostPct)} a year).
            Upside pays for it above {fmtUsdCompact(candidate.protection.upsideBreakEvenPrice)}.
          </small>
        </div>
      </div>
      <div className={styles.maxLoss}>MAX LOSS ON THE PUT: 100% OF WHAT YOU PAY</div>
    </div>
  );
}

function ChoiceCard({ choice, onInspect }: {
  choice: ProtectionChoice;
  onInspect: (candidate: AlphaPutCandidate) => void;
}) {
  const { candidate, hedge } = choice;
  const meta = CARD_STYLE[choice.style];
  const stressPrice = candidate.indexPrice * (1 + STRESS_MOVE_PCT / 100);
  const hedgedStress = hedgedPnlAt(candidate, hedge, stressPrice);
  const unhedgedStress = hedge.targetQty * (stressPrice - candidate.indexPrice);

  return (
    <article className={ob.outcomeCard} data-style={meta.tone}>
      <div className={ob.cardTopline}>
        <span className={ob.cardOrder}>{meta.order}</span>
        <div>
          <strong>{meta.label}</strong>
          <span>{meta.character}</span>
        </div>
        <span className={ob.venue}>{VENUES[candidate.venue]?.label ?? candidate.venue}</span>
      </div>

      <div className={ob.payoutBlock}>
        <span>Insurance cost</span>
        <strong>{fmtUsd(hedge.cost)}</strong>
        <small>
          {pct(hedge.costPctOfHolding, 2)} of the holding · {pct(candidate.protection.annualizedCostPct)} a year
        </small>
      </div>

      <div className={ob.outcomeStats}>
        <div>
          <span>Floor</span>
          <strong>{fmtUsdCompact(candidate.strike)}</strong>
        </div>
        <div>
          <span>{candidate.takerFee == null ? 'Est. worst case' : 'Worst case'}</span>
          <strong data-tone="loss">−{fmtUsdCompact(hedge.maxLoss)}</strong>
        </div>
        <div>
          <span>At {STRESS_MOVE_PCT}%</span>
          <strong data-tone={hedgedStress < 0 ? 'loss' : 'profit'}>{signedUsd(hedgedStress)}</strong>
        </div>
      </div>

      <div className={ob.pricePath}>
        <div>
          <span>Floor</span>
          <strong>{fmtUsdCompact(candidate.strike)}</strong>
        </div>
        <span className={ob.pathArrow}>←</span>
        <div>
          <span>Now</span>
          <strong>{fmtUsdCompact(candidate.indexPrice)}</strong>
        </div>
        <span className={ob.pathArrow}>→</span>
        <div>
          <span>Paid back</span>
          <strong>{fmtUsdCompact(candidate.protection.upsideBreakEvenPrice)}</strong>
        </div>
      </div>

      <div className={ob.contractLine}>
        <span>{candidate.instrument}</span>
        <span>{formatQuantity(hedge.contracts)} contracts</span>
        <span>{candidate.dte.toFixed(1)} days</span>
      </div>
      {!hedge.fullyCovered && (
        <div className={own.coverageWarning}>
          Ask size covers only {formatQuantity(hedge.coveredQty)} of {formatQuantity(hedge.targetQty)} {candidate.underlying}.
        </div>
      )}

      <details className={ob.explanation}>
        <summary>Why this put?</summary>
        <div className={ob.explanationGrid}>
          <div>
            <span>Unhedged at {STRESS_MOVE_PCT}%</span>
            <strong>{signedUsd(unhedgedStress)}</strong>
            <small>same holding, no put</small>
          </div>
          <div>
            <span>Floor distance</span>
            <strong>{pct(candidate.otmPct)}</strong>
            <small>you absorb this fall first</small>
          </div>
          <div>
            <span>Liquidity</span>
            <strong>{pct(candidate.spreadPct)} spread</strong>
            <small>{formatQuantity(candidate.askSize ?? 0)} quoted at ask</small>
          </div>
          <div>
            <span>Put pricing</span>
            <strong>{fmtIv(candidate.markIv)} IV</strong>
            <small>{skewPoints(candidate.protection.skewPremium)}</small>
          </div>
        </div>
      </details>

      <button type="button" className={ob.inspectButton} onClick={() => onInspect(candidate)}>
        Inspect contract in Advanced Radar
      </button>
    </article>
  );
}

function ProtectionBuilder({
  data,
  hedgeQtyInput,
  expiry,
  maxFloorPct,
  onHedgeQtyChange,
  onExpiryChange,
  onMaxFloorChange,
  onInspect,
}: {
  data: AlphaPutScannerResponse;
  hedgeQtyInput: string;
  expiry: string;
  maxFloorPct: number;
  onHedgeQtyChange: (value: string) => void;
  onExpiryChange: (value: string) => void;
  onMaxFloorChange: (value: number) => void;
  onInspect: (candidate: AlphaPutCandidate) => void;
}) {
  const qtyInvalid = validQty(hedgeQtyInput) == null;
  const candidateExpiries = [...new Set(data.candidates.map((candidate) => candidate.expiry))].sort();
  const resolvedExpiry = candidateExpiries.includes(expiry) ? expiry : (candidateExpiries[0] ?? '');
  const choices = buildProtectionChoices(data.candidates, resolvedExpiry);
  const dteFor = (value: string) => data.candidates.find((candidate) => candidate.expiry === value)?.dte;

  return (
    <div className={ob.builder}>
      <div className={ob.thesis}>
        <div className={ob.thesisLead}>
          <span className={ob.thesisEyebrow}>Protect what you already hold</span>
          <h3>Keep the upside.<br />Put a floor under the downside.</h3>
          <p>
            A protective put caps how much your {data.underlying} can lose until expiry. You pay for it
            up front, and the premium is gone if the market never falls.
          </p>
        </div>

        <div className={ob.thesisInputs}>
          <label className={ob.builderInput} data-invalid={qtyInvalid || undefined}>
            <span className={ob.step}>01</span>
            <div>
              <span className={ob.inputLabel}>{data.underlying} to protect</span>
              <div className={`${ob.inputShell} ${own.qtyShell}`}>
                <input
                  inputMode="decimal"
                  aria-label={`${data.underlying} quantity to protect`}
                  aria-invalid={qtyInvalid}
                  aria-errormessage={qtyInvalid ? 'put-qty-error' : undefined}
                  value={hedgeQtyInput}
                  onChange={(event) => onHedgeQtyChange(event.target.value)}
                />
                <em>{data.underlying}</em>
              </div>
              {qtyInvalid ? (
                <small id="put-qty-error" className={ob.inputError} role="alert">
                  Enter a quantity above 0.
                </small>
              ) : (
                <small className={ob.inputHint}>
                  ≈ {fmtUsdCompact((validQty(hedgeQtyInput) ?? 0) * (data.indexPrice ?? 0))} at spot
                </small>
              )}
            </div>
          </label>

          <label className={ob.builderInput}>
            <span className={ob.step}>02</span>
            <div>
              <span className={ob.inputLabel}>Protect until</span>
              <select
                aria-label="Put expiry"
                value={resolvedExpiry}
                disabled={candidateExpiries.length === 0}
                onChange={(event) => onExpiryChange(event.target.value)}
              >
                {candidateExpiries.map((value) => {
                  const dte = dteFor(value);
                  return (
                    <option key={value} value={value}>
                      {dte == null ? formatExpiry(value) : `${formatExpiry(value)} · ${Math.max(0, Math.round(dte))} days`}
                    </option>
                  );
                })}
              </select>
              <small className={ob.inputHint}>{GUIDED_MIN_DTE}–{GUIDED_MAX_DTE} days</small>
            </div>
          </label>

          <div className={ob.builderInput}>
            <span className={ob.step}>03</span>
            <div>
              <span className={ob.inputLabel}>Deepest floor considered</span>
              <div className={own.floorPresets} role="group" aria-label="Deepest floor considered">
                {FLOOR_PRESETS.map((value) => (
                  <button
                    type="button"
                    key={value}
                    data-active={maxFloorPct === value}
                    aria-pressed={maxFloorPct === value}
                    onClick={() => onMaxFloorChange(value)}
                  >
                    −{value}%
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {qtyInvalid ? (
        <div className={ob.noOutcomes}>
          <strong>Enter how much {data.underlying} you want to protect.</strong>
          <span>The hedge is sized in contracts to cover that quantity.</span>
        </div>
      ) : choices.length === 0 ? (
        <div className={ob.noOutcomes}>
          <strong>No liquid put covers this holding for the selected date.</strong>
          <span>Try another expiry, a deeper floor, or inspect the full board in Advanced Radar.</span>
        </div>
      ) : (
        <div className={ob.outcomeSection}>
          <div className={ob.sectionHeader}>
            <div>
              <span>Ways to insure the holding</span>
              <strong>Same holding. Different floor and price.</strong>
            </div>
            <small>Worst case is at expiry from live asks, holding valued at the current index.</small>
          </div>
          <div className={ob.outcomeGrid}>
            {choices.map((choice) => (
              <ChoiceCard
                key={`${choice.candidate.venue}:${choice.candidate.instrument}`}
                choice={choice}
                onInspect={onInspect}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProtectivePutPanel({ underlying, venues }: ProtectivePutPanelProps) {
  const [view, setView] = useState<ScannerView>('guided');
  const [hedgeQtyInput, setHedgeQtyInput] = useState('1');
  const [guidedExpiry, setGuidedExpiry] = useState('');
  const [maxFloorPct, setMaxFloorPct] = useState<number>(20);
  const [premiumCap, setPremiumCap] = useState<number>(1_000);
  const [minOtmPct, setMinOtmPct] = useState<number>(5);
  const [rankBy, setRankBy] = useState<AlphaPutRankBy>('convexity');
  const [buyingPowerInput, setBuyingPowerInput] = useState('2400');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const replaceLegs = useStrategyStore((state) => state.replaceLegs);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const setBuilderVariant = useAppStore((state) => state.setBuilderVariant);
  const setExpiry = useAppStore((state) => state.setExpiry);

  const buyingPower = Number(buyingPowerInput);
  const buyingPowerIsValid = Number.isFinite(buyingPower) && buyingPower > 0 && buyingPower <= 10_000_000;
  const deferredBuyingPower = useDeferredValue(buyingPowerIsValid ? buyingPower : 2_400);
  const hedgeQty = useDeferredValue(validQty(hedgeQtyInput) ?? 1);
  const activeVenues = scannerVenues(venues);
  const guided = view === 'guided';

  const query = usePutScanner(
    {
      underlying,
      venues: activeVenues,
      premiumCap: guided ? 100_000 : premiumCap,
      minDte: guided ? GUIDED_MIN_DTE : ADVANCED_MIN_DTE,
      maxDte: guided ? GUIDED_MAX_DTE : ADVANCED_MAX_DTE,
      minOtmPct: guided ? 0 : minOtmPct,
      maxOtmPct: guided ? maxFloorPct : 50,
      hedgeQty,
      buyingPower: deferredBuyingPower,
      marginHaircut: 1.2,
      maxSpreadPct: 40,
      rankBy: guided ? 'protection' : rankBy,
      limit: guided ? 60 : 30,
      diversifyExpiries: guided,
    },
    activeVenues.length > 0 && (guided || buyingPowerIsValid),
  );
  const data = query.data;
  const selected =
    data?.candidates.find((candidate) => `${candidate.venue}:${candidate.instrument}` === selectedKey) ??
    data?.candidates[0] ??
    null;
  const unavailableVenues = data?.venueStatus.filter((status) => status.error != null) ?? [];

  function openInBuilderV2(candidate: AlphaPutCandidate): void {
    replaceLegs([putCandidateToBuilderLeg(candidate)], candidate.underlying);
    setExpiry(candidate.expiry);
    setBuilderVariant('v2');
    setActiveTab('architect');
  }

  return (
    <section className={styles.panel}>
      <header className={styles.header}>
        <div>
          <div className={styles.eyebrow}>
            {underlying} · {activeVenues.length} ACTIVE VENUES · LONG PUTS
          </div>
          <h2 className={styles.title}>{guided ? 'Insure the stack' : 'Long put radar'}</h2>
          <p className={styles.description}>
            {guided
              ? 'Size a protective put to the coin you hold and compare floor against premium.'
              : 'Every liquid OTM put with bet and insurance economics side by side. Hover a contract for the read.'}
          </p>
        </div>
        <div className={styles.headerActions}>
          <div className={styles.viewSwitch} role="group" aria-label="Long put view">
            <button type="button" data-active={guided} aria-pressed={guided} onClick={() => setView('guided')}>
              Protect
            </button>
            <button type="button" data-active={!guided} aria-pressed={!guided} onClick={() => setView('advanced')}>
              Advanced radar
            </button>
          </div>
          <span className={styles.scanOnly}>SCAN ONLY</span>
          {!guided && (
            <button
              type="button"
              className={styles.exportButton}
              disabled={!data || data.candidates.length === 0}
              onClick={() => data && downloadCsv(data)}
            >
              CSV
            </button>
          )}
        </div>
      </header>

      {!guided && (
        <div className={`${styles.controls} ${own.controls}`}>
          <fieldset className={styles.controlGroup}>
            <legend><MetricTip label="Rank by" tip={CONTROL_TIPS.rank} /></legend>
            <div className={styles.presetRow}>
              {(['convexity', 'protection'] as const).map((value) => (
                <button type="button" key={value} data-active={rankBy === value} onClick={() => setRankBy(value)}>
                  {value === 'convexity' ? 'Bet' : 'Hedge'}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className={styles.controlGroup}>
            <legend><MetricTip label="Max contract mark" tip={CONTROL_TIPS.mark} /></legend>
            <div className={styles.presetRow}>
              {PREMIUM_PRESETS.map((value) => (
                <button type="button" key={value} data-active={premiumCap === value} onClick={() => setPremiumCap(value)}>
                  ${value.toLocaleString()}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className={styles.controlGroup}>
            <legend><MetricTip label="Min OTM" tip={CONTROL_TIPS.otm} /></legend>
            <div className={styles.presetRow}>
              {OTM_PRESETS.map((value) => (
                <button type="button" key={value} data-active={minOtmPct === value} onClick={() => setMinOtmPct(value)}>
                  {value}%
                </button>
              ))}
            </div>
          </fieldset>
          <label className={styles.budgetControl} data-invalid={!buyingPowerIsValid || undefined}>
            <span><MetricTip label="Buying power" tip={CONTROL_TIPS.bankroll} /></span>
            <div className={styles.inputShell}>
              <span>$</span>
              <input
                inputMode="decimal"
                value={buyingPowerInput}
                aria-label="Put scanner buying power"
                aria-invalid={!buyingPowerIsValid}
                aria-errormessage={!buyingPowerIsValid ? 'put-advanced-budget-error' : undefined}
                onChange={(event) => setBuyingPowerInput(event.target.value)}
              />
            </div>
            {!buyingPowerIsValid && (
              <small id="put-advanced-budget-error" className={styles.controlError} role="alert">
                Enter $1 to $10,000,000.
              </small>
            )}
          </label>
          <div className={styles.fixedRules}>
            <span>{ADVANCED_MIN_DTE}–{ADVANCED_MAX_DTE} DTE</span>
            <span>≤40% spread</span>
            <span>1.2× reserve</span>
          </div>
        </div>
      )}

      {query.isLoading && !data && (
        <div className={styles.loading}>
          <Spinner size="sm" label={`Scanning ${activeVenues.length} venues…`} />
        </div>
      )}

      {activeVenues.length === 0 && (
        <div className={styles.message}>No supported active venues are available for this scan.</div>
      )}

      {query.error && !data && (
        <div className={styles.message} data-tone="error">
          Scanner unavailable: {query.error instanceof Error ? query.error.message : 'request failed'}
        </div>
      )}

      {query.error && data && (
        <div className={styles.message} data-tone="error">
          Refresh failed; showing the scan from {new Date(data.generatedAt).toLocaleTimeString()}.
        </div>
      )}

      {data && (
        <>
          <div className={styles.marketStrip}>
            <span>{underlying} NOW <strong>{fmtUsdCompact(data.indexPrice)}</strong></span>
            <span>HORIZON <strong>{data.config.minDte}–{data.config.maxDte} DAYS</strong></span>
            <span>LIVE PUTS <strong>{data.candidates.length}</strong></span>
            <span>EXPIRIES <strong>{data.eligibleExpiries.length}</strong></span>
            <span>LIVE VENUES <strong>{data.venueStatus.filter((status) => status.scannedContracts > 0).length}/{data.venues.length}</strong></span>
            {query.isFetching && <span className={styles.refreshing}>REFRESHING</span>}
          </div>
          {unavailableVenues.length > 0 && (
            <div className={styles.venueWarning}>
              Partial or no scan data from {unavailableVenues.map((status) => VENUES[status.venue]?.label ?? status.venue).join(', ')}.
            </div>
          )}

          {guided ? (
            <ProtectionBuilder
              data={data}
              hedgeQtyInput={hedgeQtyInput}
              expiry={guidedExpiry}
              maxFloorPct={maxFloorPct}
              onHedgeQtyChange={setHedgeQtyInput}
              onExpiryChange={setGuidedExpiry}
              onMaxFloorChange={setMaxFloorPct}
              onInspect={(candidate) => {
                setSelectedKey(`${candidate.venue}:${candidate.instrument}`);
                setRankBy('protection');
                setMinOtmPct(0);
                setPremiumCap(2_500);
                setView('advanced');
              }}
            />
          ) : data.candidates.length === 0 ? (
            <div className={styles.message}>
              No liquid {underlying} puts match these mark, moneyness, DTE, and venue limits.
            </div>
          ) : (
            <div className={styles.results}>
              <div className={styles.tableScroll}>
                <div className={styles.table}>
                  <div className={styles.tableHeader}>
                    <div>Venue / contract</div>
                    <div><MetricTip label="Mark / ask" tip={COLUMN_TIPS.price} /></div>
                    <div><MetricTip label="IV / skew" tip={COLUMN_TIPS.volatility} /></div>
                    <div><MetricTip label="OTM / BE" tip={COLUMN_TIPS.breakeven} /></div>
                    {rankBy === 'convexity'
                      ? <div><MetricTip label="5× move" tip={COLUMN_TIPS.target} /></div>
                      : <div><MetricTip label="Insurance" tip={COLUMN_TIPS.insurance} /></div>}
                    <div><MetricTip label="Capacity" tip={COLUMN_TIPS.capacity} placement="bottom-end" /></div>
                  </div>
                  {data.candidates.map((candidate) => {
                    const key = `${candidate.venue}:${candidate.instrument}`;
                    const fiveX = targetFor(candidate, 5);
                    return (
                      <HoverTooltip
                        as="button"
                        className={styles.row}
                        dataSelected={selected != null && key === `${selected.venue}:${selected.instrument}` ? 'true' : 'false'}
                        ariaLabel={`Select ${candidate.instrument} and show its plain-language explanation`}
                        content={<PutBetTooltip candidate={candidate} />}
                        key={key}
                        onActivate={() => setSelectedKey(key)}
                      >
                        <div className={styles.contractCell}>
                          <span className={styles.venue}>{VENUES[candidate.venue]?.label ?? candidate.venue}</span>
                          <strong>{candidate.instrument}</strong>
                          <span>{candidate.dte.toFixed(1)} DTE · K {candidate.strike.toLocaleString()}</span>
                        </div>
                        <div className={styles.numericCell}>
                          <strong>{fmtUsd(candidate.mark)}</strong>
                          <span>{fmtUsd(candidate.ask)} ask · {pct(candidate.spreadPct)} wide</span>
                        </div>
                        <div className={styles.numericCell}>
                          <strong>{fmtIv(candidate.markIv)}</strong>
                          <span>{skewPoints(candidate.protection.skewPremium)}</span>
                        </div>
                        <div className={styles.numericCell}>
                          <strong>−{pct(candidate.otmPct)}</strong>
                          <span>BE {fmtPct(candidate.breakEvenMovePct, 1)}</span>
                        </div>
                        {rankBy === 'convexity' ? (
                          <div className={styles.targetCell}>
                            <strong>{fmtPct(fiveX?.modelMovePct ?? null, 1)}</strong>
                            <span>{fiveX?.impliedMoveMultiple == null ? '—' : `${fiveX.impliedMoveMultiple.toFixed(2)} implied`}</span>
                          </div>
                        ) : (
                          <div className={styles.targetCell}>
                            <strong>{pct(candidate.protection.costPct, 2)}</strong>
                            <span>{pct(candidate.protection.annualizedCostPct)} / yr</span>
                            <small>worst {pct(candidate.protection.maxLossPct)}</small>
                          </div>
                        )}
                        <div className={styles.capacityCell}>
                          <strong>{formatQuantity(candidate.quantityAtAsk)}</strong>
                          <span>{formatQuantity(candidate.conservativeQuantity)} reserved</span>
                        </div>
                      </HoverTooltip>
                    );
                  })}
                </div>
              </div>
              {selected && <PutInspector candidate={selected} onOpenBuilder={openInBuilderV2} />}
            </div>
          )}
        </>
      )}

      <footer className={styles.footer}>
        {guided ? (
          <span>
            Worst case assumes the holding is valued at today’s index and the put is held to expiry. Unknown venue fees are excluded.
          </span>
        ) : (
          <span>Targets measure return on estimated entry cost and hold current IV and time constant.</span>
        )}
        <span>No order is sent. An unused protective put expires worthless; that premium is the cost of the floor.</span>
      </footer>
    </section>
  );
}

function PutInspector({ candidate, onOpenBuilder }: {
  candidate: AlphaPutCandidate;
  onOpenBuilder: (candidate: AlphaPutCandidate) => void;
}) {
  return (
    <aside className={styles.inspector}>
      <div className={styles.inspectorHeader}>
        <div>
          <span>{VENUES[candidate.venue]?.label ?? candidate.venue}</span>
          <strong>{candidate.instrument}</strong>
        </div>
        <div className={styles.inspectorMeta}>
          <span>{candidate.contractSize} {candidate.underlying} / contract</span>
          <span>min {candidate.minQty} · {candidate.inverse ? 'inverse' : candidate.settle}</span>
          <span>min order {fmtUsd(candidate.minimumOrderCost)}</span>
          <span>{candidate.referenceSource === 'venue-forward' ? 'venue forward' : 'spot proxy'}</span>
        </div>
      </div>
      <div className={styles.targetGrid}>
        {candidate.targets.map((target) => (
          <div key={target.multiple}>
            <span>{target.multiple}× ASK</span>
            <strong>{fmtUsdCompact(target.modelUnderlyingPrice)}</strong>
            <small>
              {fmtPct(target.modelMovePct, 1)} · {target.impliedMoveMultiple == null ? '—' : `${target.impliedMoveMultiple.toFixed(2)} implied`}
            </small>
            <small>expiry intrinsic {fmtUsdCompact(target.intrinsicUnderlyingPrice)}</small>
          </div>
        ))}
      </div>
      <div className={styles.shockGrid}>
        <span>EXPIRY INTRINSIC</span>
        {candidate.shocks.map((shock) => (
          <div key={shock.movePct}>
            <span>{shock.movePct}%</span>
            <strong>{shock.intrinsicMultiple.toFixed(1)}×</strong>
            <small>{fmtUsdCompact(shock.underlyingPrice)}</small>
          </div>
        ))}
      </div>
      <div className={styles.greeksLine}>
        <span>FLOOR COST {pct(candidate.protection.costPct, 2)}</span>
        <span>{pct(candidate.protection.annualizedCostPct)} / YR</span>
        <span>WORST {pct(candidate.protection.maxLossPct)}</span>
      </div>
      <div className={styles.greeksLine}>
        <span>Δ {fmtDelta(candidate.delta)}</span>
        <span>IV {fmtIv(candidate.markIv)}</span>
        <span>ASK SIZE {candidate.askSize ?? '—'}</span>
      </div>
      <button type="button" className={styles.builderButton} onClick={() => onOpenBuilder(candidate)}>
        <span>Open in Builder V2</span>
        <span aria-hidden="true">↗</span>
      </button>
    </aside>
  );
}
