import { useDeferredValue, useState } from 'react';
import type {
  AlphaLottoCandidate,
  AlphaLottoScannerResponse,
  AlphaLottoTarget,
} from '@oggregator/protocol';

import { Spinner } from '@components/ui';
import { fmtDelta, fmtIv, fmtPct, fmtUsd, fmtUsdCompact } from '@lib/format';

import { useLottoScanner } from './useLottoScanner';
import styles from './LottoScannerPanel.module.css';

const PREMIUM_PRESETS = [100, 200, 400, 500] as const;
const OTM_PRESETS = [5, 8, 10, 15] as const;

function targetFor(candidate: AlphaLottoCandidate, multiple: number): AlphaLottoTarget | null {
  return candidate.targets.find((target) => target.multiple === multiple) ?? null;
}

function targetMove(target: AlphaLottoTarget | null): number | null {
  return target?.black76MovePct ?? target?.intrinsicMovePct ?? null;
}

function moveContext(movePct: number | null): string {
  if (movePct == null) return 'IV unavailable';
  if (movePct < 15) return 'below 15–20% reference';
  if (movePct <= 20) return 'similar to 15–20% reference';
  return 'above 15–20% reference';
}

function csvCell(value: string | number | null): string {
  if (value == null) return '';
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function downloadCsv(data: AlphaLottoScannerResponse): void {
  const headers = [
    'instrument',
    'expiry',
    'dte',
    'strike',
    'mark',
    'bid',
    'ask',
    'delta',
    'mark_iv',
    'otm_pct',
    'expiry_be_pct',
    'contracts_at_mark',
    'contracts_at_ask',
    'conservative_contracts',
    'btc_5x_bs',
    'move_5x_bs_pct',
    'btc_10x_bs',
    'move_10x_bs_pct',
    'btc_25x_bs',
    'move_25x_bs_pct',
  ];
  const rows = data.candidates.map((candidate) => {
    const targets = [5, 10, 25].map((multiple) => targetFor(candidate, multiple));
    return [
      candidate.instrument,
      candidate.expiry,
      candidate.dte,
      candidate.strike,
      candidate.mark,
      candidate.bid,
      candidate.ask,
      candidate.delta,
      candidate.markIv,
      candidate.otmPct,
      candidate.breakEvenMovePct,
      candidate.contractsAtMark,
      candidate.contractsAtAsk,
      candidate.conservativeContracts,
      ...targets.flatMap((target) => [target?.black76BtcPrice ?? null, target?.black76MovePct ?? null]),
    ];
  });
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `thalex-btc-lotto-${new Date(data.generatedAt).toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function LottoScannerPanel() {
  const [premiumCap, setPremiumCap] = useState(400);
  const [minOtmPct, setMinOtmPct] = useState(5);
  const [buyingPowerInput, setBuyingPowerInput] = useState('2400');
  const buyingPower = Number(buyingPowerInput);
  const validBuyingPower = Number.isFinite(buyingPower) && buyingPower > 0 ? buyingPower : 2_400;
  const deferredBuyingPower = useDeferredValue(validBuyingPower);

  const query = useLottoScanner({
    premiumCap,
    minDte: 4,
    maxDte: 14,
    minOtmPct,
    maxOtmPct: 50,
    buyingPower: deferredBuyingPower,
    marginHaircut: 1.2,
    maxSpreadPct: 50,
    limit: 10,
  });
  const data = query.data;

  return (
    <section className={styles.panel}>
      <header className={styles.header}>
        <div>
          <div className={styles.eyebrow}>THALEX · BTCUSD · LONG CALLS</div>
          <h2 className={styles.title}>Lotto radar</h2>
          <p className={styles.description}>
            Short-dated OTM calls ranked by absolute mark, then estimated 10x move and spread.
          </p>
        </div>
        <div className={styles.headerActions}>
          <span className={styles.scanOnly}>SCAN ONLY</span>
          <button
            type="button"
            className={styles.exportButton}
            disabled={!data || data.candidates.length === 0}
            onClick={() => data && downloadCsv(data)}
          >
            CSV
          </button>
        </div>
      </header>

      <div className={styles.controls}>
        <fieldset className={styles.controlGroup}>
          <legend>Max mark</legend>
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
          <legend>Min OTM</legend>
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
        <label className={styles.budgetControl}>
          <span>Buying power</span>
          <div className={styles.inputShell}>
            <span>$</span>
            <input
              inputMode="decimal"
              value={buyingPowerInput}
              aria-label="Scanner buying power"
              onChange={(event) => setBuyingPowerInput(event.target.value)}
            />
          </div>
        </label>
        <div className={styles.fixedRules}>
          <span>4–14 DTE</span>
          <span>≤50% spread</span>
          <span>1.2× reserve</span>
        </div>
      </div>

      {query.isLoading && !data && (
        <div className={styles.loading}>
          <Spinner size="sm" label="Scanning Thalex calls…" />
        </div>
      )}

      {query.error && !data && (
        <div className={styles.message} data-tone="error">
          Scanner unavailable: {query.error instanceof Error ? query.error.message : 'request failed'}
        </div>
      )}

      {data && (
        <>
          <div className={styles.marketStrip}>
            <span>
              INDEX <strong>{fmtUsdCompact(data.indexPrice)}</strong>
            </span>
            <span>
              FORWARD <strong>{fmtUsdCompact(data.forwardPrice)}</strong>
            </span>
            <span>
              ELIGIBLE <strong>{data.eligibleExpiries.length} EXP</strong>
            </span>
            <span>
              MATCHES <strong>{data.candidates.length}</strong>
            </span>
            {query.isFetching && <span className={styles.refreshing}>REFRESHING</span>}
          </div>

          {data.candidates.length === 0 ? (
            <div className={styles.message}>
              No liquid Thalex BTC calls match these mark, moneyness, and DTE limits.
            </div>
          ) : (
            <div className={styles.tableScroll}>
              <div className={styles.table}>
                <div className={styles.tableHeader}>
                  <div>Contract</div>
                  <div>Mark / Ask</div>
                  <div>Δ / IV</div>
                  <div>OTM / BE</div>
                  <div>Fit M/A/C</div>
                  <div>5× estimate</div>
                  <div>10× estimate</div>
                  <div>25× estimate</div>
                  <div>Expiry intrinsic after rip</div>
                </div>
                {data.candidates.map((candidate) => (
                  <CandidateRow key={candidate.instrument} candidate={candidate} />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <footer className={styles.footer}>
        <span>M/A/C = mark capacity / ask capacity / ask with 1.2× reserve.</span>
        <span>
          5×–25× uses constant current IV and remaining time; intrinsic levels assume expiry.
          Most short-dated OTM calls expire worthless.
        </span>
        <span>No order is sent. Strategy Builder or funded-account eligibility is not assumed.</span>
      </footer>
    </section>
  );
}

interface CandidateRowProps {
  candidate: AlphaLottoCandidate;
}

function CandidateRow({ candidate }: CandidateRowProps) {
  const fiveX = targetFor(candidate, 5);
  const tenX = targetFor(candidate, 10);
  const twentyFiveX = targetFor(candidate, 25);
  return (
    <div className={styles.row}>
      <div className={styles.contractCell}>
        <strong>{candidate.instrument}</strong>
        <span>{candidate.dte.toFixed(1)} DTE · K {candidate.strike.toLocaleString()}</span>
      </div>
      <div className={styles.numericCell}>
        <strong>{fmtUsd(candidate.mark)}</strong>
        <span>{fmtUsd(candidate.ask)} ask · {fmtPct(candidate.spreadPct, 1)} wide</span>
      </div>
      <div className={styles.numericCell}>
        <strong>{fmtDelta(candidate.delta)}</strong>
        <span>{fmtIv(candidate.markIv)}</span>
      </div>
      <div className={styles.numericCell}>
        <strong>{fmtPct(candidate.otmPct, 1)}</strong>
        <span>BE {fmtPct(candidate.breakEvenMovePct, 1)}</span>
      </div>
      <div className={styles.capacityCell}>
        <strong>{candidate.contractsAtMark}/{candidate.contractsAtAsk}/{candidate.conservativeContracts}</strong>
        <span>whole BTC units</span>
      </div>
      <TargetCell target={fiveX} />
      <TargetCell target={tenX} context />
      <TargetCell target={twentyFiveX} />
      <div className={styles.shockCell}>
        {candidate.shocks.map((shock) => (
          <span key={shock.movePct}>
            +{shock.movePct}% <strong>{shock.intrinsicMultiple.toFixed(1)}×</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

interface TargetCellProps {
  target: AlphaLottoTarget | null;
  context?: boolean;
}

function TargetCell({ target, context = false }: TargetCellProps) {
  const move = targetMove(target);
  return (
    <div
      className={styles.targetCell}
      title={
        target == null
          ? undefined
          : `Expiry intrinsic level ${fmtUsdCompact(target.intrinsicBtcPrice)} (${fmtPct(target.intrinsicMovePct, 1)})`
      }
    >
      <strong>{fmtUsdCompact(target?.black76BtcPrice)}</strong>
      <span>{fmtPct(move, 1)}</span>
      {context && <small>{moveContext(move)}</small>}
    </div>
  );
}
