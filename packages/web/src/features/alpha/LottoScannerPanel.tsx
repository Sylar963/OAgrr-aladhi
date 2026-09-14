import { useDeferredValue, useState } from 'react';
import {
  VenueIdSchema,
  type AlphaLottoCandidate,
  type AlphaLottoScannerResponse,
  type AlphaLottoTarget,
  type VenueId,
} from '@oggregator/protocol';

import { Spinner } from '@components/ui';
import HoverTooltip from '@components/ui/HoverTooltip';
import { useStrategyStore } from '@features/architect/strategy-store';
import { fmtDelta, fmtIv, fmtPct, fmtUsd, fmtUsdCompact, formatExpiry } from '@lib/format';
import { VENUES } from '@lib/venue-meta';
import { useAppStore } from '@stores/app-store';

import LottoOutcomeBuilder from './LottoOutcomeBuilder';
import { candidateToBuilderLeg } from './radar-builder';
import { useLottoScanner } from './useLottoScanner';
import styles from './LottoScannerPanel.module.css';

const PREMIUM_PRESETS = [100, 200, 400, 500] as const;
const OTM_PRESETS = [5, 8, 10, 15] as const;
const GUIDED_MIN_DTE = 15;
const GUIDED_MAX_DTE = 75;
const GUIDED_PREMIUM_CAP = 10_000;
const GUIDED_SCANNER_BUYING_POWER = 2_400;
type ScannerView = 'guided' | 'advanced';

const CONTROL_TIPS = {
  mark: 'The sticker price used to filter the board. Your real buy-in is the ask, which can be higher.',
  otm: 'How far the market must climb just to touch the strike. Farther out means a cheaper long shot, but a harder hit.',
  bankroll: 'Your total bankroll for sizing. The scanner shows what fits; it never places an order.',
} as const;

const COLUMN_TIPS = {
  price: 'MARK is the table estimate. ASK is the quoted price before taker fees.',
  volatility: 'IV is how much movement the option market is pricing in. Higher IV usually means a more expensive bet.',
  breakeven: 'OTM is the climb to the strike. BE uses the current ask plus the estimated taker fee when available.',
  target: 'A model of the market move that could make the option worth 10× your ask-paid entry cost. It is not a probability or guarantee.',
  capacity: 'How many contracts your bankroll can cover at fee-adjusted ask, capped by quoted ask size. Reserved also uses a safety buffer.',
} as const;

interface LottoScannerPanelProps {
  underlying: string;
  venues: string[];
}

function targetFor(candidate: AlphaLottoCandidate, multiple: number): AlphaLottoTarget | null {
  return candidate.targets.find((target) => target.multiple === multiple) ?? null;
}

function scannerVenues(venues: string[]): VenueId[] {
  return venues.flatMap((venue) => {
    const parsed = VenueIdSchema.safeParse(venue);
    return parsed.success ? [parsed.data] : [];
  });
}

function moveContext(target: AlphaLottoTarget | null): string {
  const ratio = target?.impliedMoveMultiple;
  if (ratio == null) return 'ATM IV unavailable';
  if (ratio <= 1.5) return 'within 1.5 implied moves';
  if (ratio <= 2) return '1.5–2 implied moves';
  return 'over 2 implied moves';
}

function csvCell(value: string | number | boolean | null): string {
  if (value == null) return '';
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function downloadCsv(data: AlphaLottoScannerResponse): void {
  const headers = [
    'venue',
    'underlying',
    'instrument',
    'expiry',
    'dte',
    'strike',
    'contract_size',
    'min_qty',
    'inverse',
    'reference_source',
    'mark_usd',
    'bid_usd',
    'ask_usd',
    'taker_fee_usd',
    'entry_cost_usd',
    'mark_iv',
    'atm_iv',
    'expected_move_pct',
    'otm_pct',
    'expiry_be_pct',
    'quantity_at_ask',
    'conservative_quantity',
    'move_10x_pct',
    'implied_moves_10x',
  ];
  const rows = data.candidates.map((candidate) => {
    const tenX = targetFor(candidate, 10);
    return [
      candidate.venue,
      candidate.underlying,
      candidate.instrument,
      candidate.expiry,
      candidate.dte,
      candidate.strike,
      candidate.contractSize,
      candidate.minQty,
      candidate.inverse,
      candidate.referenceSource,
      candidate.mark,
      candidate.bid,
      candidate.ask,
      candidate.takerFee,
      candidate.entryCost,
      candidate.markIv,
      candidate.atmIv,
      candidate.expectedMovePct,
      candidate.otmPct,
      candidate.breakEvenMovePct,
      candidate.quantityAtAsk,
      candidate.conservativeQuantity,
      tenX?.modelMovePct ?? null,
      tenX?.impliedMoveMultiple ?? null,
    ];
  });
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${data.underlying.toLowerCase()}-long-call-scan-${new Date(data.generatedAt).toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function formatQuantity(value: number): string {
  return value >= 100 ? value.toFixed(0) : value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

interface MetricTipProps {
  label: string;
  tip: string;
  placement?: 'bottom-start' | 'bottom-end';
}

function MetricTip({ label, tip, placement = 'bottom-start' }: MetricTipProps) {
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

function CallBetTooltip({ candidate }: { candidate: AlphaLottoCandidate }) {
  const tenX = targetFor(candidate, 10);
  const expiry = formatExpiry(candidate.expiry);

  return (
    <div className={styles.betTooltip}>
      <div className={styles.betTooltipHeader}>
        <span>THE HAND · LONG CALL</span>
        <strong>{candidate.underlying} UP BEFORE {expiry.toUpperCase()}</strong>
      </div>
      <p>
        You are paying for a shot at a fast upside run. Like drawing to a big hand, your buy-in is capped,
        but the clock can fold you even when you guessed the direction right.
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
          <small>Venue minimum costs {fmtUsd(candidate.minimumOrderCost)}.</small>
        </div>
        <div data-tone="win">
          <span>PROFIT LINE AT EXPIRY</span>
          <strong>{candidate.underlying} above {fmtUsdCompact(candidate.breakEvenPrice)}</strong>
          <small>That is a {fmtPct(candidate.breakEvenMovePct, 1)} climb from now.</small>
        </div>
        <div data-tone="bust">
          <span>BUST LINE AT EXPIRY</span>
          <strong>{candidate.underlying} at or below {fmtUsdCompact(candidate.strike)}</strong>
          <small>The call expires worth $0 and the full buy-in is lost.</small>
        </div>
      </div>
      <div className={styles.betFootnote}>
        <strong>10× OUT:</strong>{' '}
        {tenX?.modelUnderlyingPrice == null
          ? 'The model cannot price this scenario.'
          : `${candidate.underlying} near ${fmtUsdCompact(tenX.modelUnderlyingPrice)} (${fmtPct(tenX.modelMovePct, 1)}).`}{' '}
        Assumes IV and time stay unchanged; this is not odds and not an expiry payout.
      </div>
      <div className={styles.maxLoss}>MAX LOSS: 100% OF WHAT YOU PAY · NO LOSS BEYOND THE PREMIUM</div>
    </div>
  );
}

export default function LottoScannerPanel({ underlying, venues }: LottoScannerPanelProps) {
  const [view, setView] = useState<ScannerView>('guided');
  const [advancedLimit, setAdvancedLimit] = useState(20);
  const [premiumCap, setPremiumCap] = useState(400);
  const [minOtmPct, setMinOtmPct] = useState(5);
  const [buyingPowerInput, setBuyingPowerInput] = useState('2400');
  const [riskBudgetInput, setRiskBudgetInput] = useState('250');
  const [targetPriceInput, setTargetPriceInput] = useState('');
  const [outcomeExpiry, setOutcomeExpiry] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const replaceLegs = useStrategyStore((state) => state.replaceLegs);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const setBuilderVariant = useAppStore((state) => state.setBuilderVariant);
  const setExpiry = useAppStore((state) => state.setExpiry);
  const buyingPower = Number(buyingPowerInput);
  const buyingPowerIsValid = Number.isFinite(buyingPower) && buyingPower > 0 && buyingPower <= 10_000_000;
  const validBuyingPower = buyingPowerIsValid ? buyingPower : 2_400;
  const deferredAdvancedBuyingPower = useDeferredValue(validBuyingPower);
  const queryBuyingPower = view === 'guided' ? GUIDED_SCANNER_BUYING_POWER : deferredAdvancedBuyingPower;
  const activeVenues = scannerVenues(venues);

  const query = useLottoScanner(
    {
      underlying,
      venues: activeVenues,
      premiumCap: view === 'guided' ? GUIDED_PREMIUM_CAP : premiumCap,
      minDte: view === 'guided' ? GUIDED_MIN_DTE : 4,
      maxDte: view === 'guided' ? GUIDED_MAX_DTE : 14,
      minOtmPct,
      maxOtmPct: 50,
      buyingPower: queryBuyingPower,
      marginHaircut: 1.2,
      maxSpreadPct: 50,
      limit: view === 'guided' ? 50 : advancedLimit,
      diversifyExpiries: view === 'guided',
    },
    activeVenues.length > 0 && (view === 'guided' || buyingPowerIsValid),
  );
  const data = query.data;
  const selected =
    data?.candidates.find((candidate) => `${candidate.venue}:${candidate.instrument}` === selectedKey) ??
    data?.candidates[0] ??
    null;
  const unavailableVenues = data?.venueStatus.filter((status) => status.error != null) ?? [];

  function openInBuilderV2(candidate: AlphaLottoCandidate): void {
    replaceLegs([candidateToBuilderLeg(candidate)], candidate.underlying);
    setExpiry(candidate.expiry);
    setBuilderVariant('v2');
    setActiveTab('architect');
  }

  return (
    <section className={styles.panel}>
      <header className={styles.header}>
        <div>
          <div className={styles.eyebrow}>
            {underlying} · {activeVenues.length} ACTIVE VENUES · LONG CALLS
          </div>
          <h2 className={styles.title}>{view === 'guided' ? 'Own the upside' : 'Lotto radar'}</h2>
          <p className={styles.description}>
            {view === 'guided'
              ? 'Define one possible future, cap what you can lose, and compare ways to own it.'
              : 'Ranked by the 10× move relative to each expiry’s ATM implied move. Hover a contract for the poker read.'}
          </p>
        </div>
        <div className={styles.headerActions}>
          <div className={styles.viewSwitch} role="group" aria-label="Lotto radar view">
            <button
              type="button"
              data-active={view === 'guided'}
              aria-pressed={view === 'guided'}
              onClick={() => setView('guided')}
            >
              Guided
            </button>
            <button
              type="button"
              data-active={view === 'advanced'}
              aria-pressed={view === 'advanced'}
              onClick={() => {
                setAdvancedLimit(20);
                setView('advanced');
              }}
            >
              Advanced radar
            </button>
          </div>
          <span className={styles.scanOnly}>SCAN ONLY</span>
          {view === 'advanced' && (
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

      {view === 'advanced' && (
        <div className={styles.controls}>
          <fieldset className={styles.controlGroup}>
            <legend><MetricTip label="Max contract mark" tip={CONTROL_TIPS.mark} /></legend>
            <div className={styles.presetRow}>
              {PREMIUM_PRESETS.map((value) => (
                <button
                  type="button"
                  key={value}
                  data-active={premiumCap === value}
                  onClick={() => setPremiumCap(value)}
                >
                  ${value}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className={styles.controlGroup}>
            <legend><MetricTip label="Min OTM" tip={CONTROL_TIPS.otm} /></legend>
            <div className={styles.presetRow}>
              {OTM_PRESETS.map((value) => (
                <button
                  type="button"
                  key={value}
                  data-active={minOtmPct === value}
                  onClick={() => setMinOtmPct(value)}
                >
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
                aria-label="Scanner buying power"
                aria-invalid={!buyingPowerIsValid}
                aria-errormessage={!buyingPowerIsValid ? 'lotto-advanced-budget-error' : undefined}
                onChange={(event) => setBuyingPowerInput(event.target.value)}
              />
            </div>
            {!buyingPowerIsValid && (
              <small id="lotto-advanced-budget-error" className={styles.controlError} role="alert">
                Enter $1 to $10,000,000.
              </small>
            )}
          </label>
          <div className={styles.fixedRules}>
            <span>4–14 DTE</span>
            <span>≤50% spread</span>
            <span>1.2× reserve</span>
          </div>
        </div>
      )}

      {view === 'advanced' && !buyingPowerIsValid && (
        <div className={styles.message}>Enter valid buying power to run the advanced scan.</div>
      )}

      {query.isLoading && !data && (view === 'guided' || buyingPowerIsValid) && (
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

      {data && (view === 'guided' || buyingPowerIsValid) && (
        <>
          <div className={styles.marketStrip}>
            {view === 'guided' ? (
              <>
                <span>{underlying} NOW <strong>{fmtUsdCompact(data.indexPrice)}</strong></span>
                <span>HORIZON <strong>15–75 DAYS</strong></span>
                <span>LIVE CALLS <strong>{data.candidates.length}</strong></span>
                <span>AVAILABLE DATES <strong>{data.eligibleExpiries.length}</strong></span>
                <span>LIVE VENUES <strong>{data.venueStatus.filter((status) => status.scannedContracts > 0).length}/{data.venues.length}</strong></span>
              </>
            ) : (
              <>
                <span>INDEX <strong>{fmtUsdCompact(data.indexPrice)}</strong></span>
                <span>AVG FORWARD <strong>{fmtUsdCompact(data.forwardPrice)}</strong></span>
                <span>EXPIRIES <strong>{data.eligibleExpiries.length}</strong></span>
                <span>MATCHES <strong>{data.candidates.length}</strong></span>
                <span>SCANNED VENUES <strong>{data.venueStatus.filter((status) => status.scannedContracts > 0).length}/{data.venues.length}</strong></span>
              </>
            )}
            {query.isFetching && <span className={styles.refreshing}>REFRESHING</span>}
          </div>
          {unavailableVenues.length > 0 && (
            <div className={styles.venueWarning}>
              Partial or no scan data from {unavailableVenues.map((status) => VENUES[status.venue]?.label ?? status.venue).join(', ')}.
            </div>
          )}

          {view === 'guided' ? (
            <LottoOutcomeBuilder
              data={data}
              targetPriceInput={targetPriceInput}
              expiry={outcomeExpiry}
              riskBudgetInput={riskBudgetInput}
              onTargetPriceChange={setTargetPriceInput}
              onExpiryChange={setOutcomeExpiry}
              onRiskBudgetChange={setRiskBudgetInput}
              onInspect={(candidate) => {
                setSelectedKey(`${candidate.venue}:${candidate.instrument}`);
                setAdvancedLimit(50);
                setView('advanced');
              }}
            />
          ) : data.candidates.length === 0 ? (
            <div className={styles.message}>
              No liquid {underlying} calls match these mark, moneyness, DTE, and venue limits.
            </div>
          ) : (
            <div className={styles.results}>
              <div className={styles.tableScroll}>
                <div className={styles.table}>
                  <div className={styles.tableHeader}>
                    <div>Venue / contract</div>
                    <div><MetricTip label="Mark / ask" tip={COLUMN_TIPS.price} /></div>
                    <div><MetricTip label="IV / implied" tip={COLUMN_TIPS.volatility} /></div>
                    <div><MetricTip label="OTM / BE" tip={COLUMN_TIPS.breakeven} /></div>
                    <div><MetricTip label="10× move" tip={COLUMN_TIPS.target} /></div>
                    <div><MetricTip label="Capacity" tip={COLUMN_TIPS.capacity} placement="bottom-end" /></div>
                  </div>
                  {data.candidates.map((candidate) => {
                    const key = `${candidate.venue}:${candidate.instrument}`;
                    const tenX = targetFor(candidate, 10);
                    return (
                      <HoverTooltip
                        as="button"
                        className={styles.row}
                        dataSelected={selected != null && key === `${selected.venue}:${selected.instrument}` ? 'true' : 'false'}
                        ariaLabel={`Select ${candidate.instrument} and show its plain-language bet explanation`}
                        content={<CallBetTooltip candidate={candidate} />}
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
                          <span>{fmtUsd(candidate.ask)} ask · {fmtPct(candidate.spreadPct, 1)} wide</span>
                        </div>
                        <div className={styles.numericCell}>
                          <strong>{fmtIv(candidate.markIv)}</strong>
                          <span>ATM {fmtIv(candidate.atmIv)} · {fmtPct(candidate.expectedMovePct, 1)}</span>
                        </div>
                        <div className={styles.numericCell}>
                          <strong>{fmtPct(candidate.otmPct, 1)}</strong>
                          <span>BE {fmtPct(candidate.breakEvenMovePct, 1)}</span>
                        </div>
                        <div className={styles.targetCell}>
                          <strong>{fmtPct(tenX?.modelMovePct ?? null, 1)}</strong>
                          <span>{tenX?.impliedMoveMultiple == null ? '—' : `${tenX.impliedMoveMultiple.toFixed(2)} implied`}</span>
                          <small>{moveContext(tenX)}</small>
                        </div>
                        <div className={styles.capacityCell}>
                          <strong>{formatQuantity(candidate.quantityAtAsk)}</strong>
                          <span>{formatQuantity(candidate.conservativeQuantity)} reserved</span>
                        </div>
                      </HoverTooltip>
                    );
                  })}
                </div>
              </div>
              {selected && (
                <CandidateInspector candidate={selected} onOpenBuilder={openInBuilderV2} />
              )}
            </div>
          )}
        </>
      )}

      <footer className={styles.footer}>
        {view === 'advanced' && (
          <>
            <span>Capacity uses fee-adjusted ask and quoted size; reserve quantity also includes the 1.2× buffer.</span>
            <span>Targets measure return on estimated entry cost and hold current IV and time constant.</span>
          </>
        )}
        {view === 'guided' && (
          <span>Guided scans 15–75 DTE for one-month and two-month calls. Payouts use intrinsic value at expiry; unknown venue fees are excluded.</span>
        )}
        <span>No order is sent. Most short-dated OTM calls expire worthless.</span>
      </footer>
    </section>
  );
}

interface CandidateInspectorProps {
  candidate: AlphaLottoCandidate;
  onOpenBuilder: (candidate: AlphaLottoCandidate) => void;
}

function CandidateInspector({ candidate, onOpenBuilder }: CandidateInspectorProps) {
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
            <span>+{shock.movePct}%</span>
            <strong>{shock.intrinsicMultiple.toFixed(1)}×</strong>
            <small>{fmtUsdCompact(shock.underlyingPrice)}</small>
          </div>
        ))}
      </div>
      <div className={styles.greeksLine}>
        <span>Δ {fmtDelta(candidate.delta)}</span>
        <span>IV {fmtIv(candidate.markIv)}</span>
        <span>ASK SIZE {candidate.askSize ?? '—'}</span>
      </div>
      <button
        type="button"
        className={styles.builderButton}
        onClick={() => onOpenBuilder(candidate)}
      >
        <span>Open in Builder V2</span>
        <span aria-hidden="true">↗</span>
      </button>
    </aside>
  );
}
