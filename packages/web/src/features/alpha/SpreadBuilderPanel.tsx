import type { EnrichedStrike } from '@shared/enriched';
import type { SpreadKind } from '@lib/analytics/verticalSpread';

import styles from './SpreadBuilderPanel.module.css';

interface Props {
  kind: SpreadKind;
  onKindChange: (k: SpreadKind) => void;
  strikes: readonly EnrichedStrike[];
  atmStrike: number | null;
  shortStrike: number | null;
  longStrike: number | null;
  onShortChange: (s: number | null) => void;
  onLongChange: (s: number | null) => void;
  riskFreeRate: number;
  T: number | null;
}

function moneyness(strike: number, atm: number | null, kind: SpreadKind): 'atm' | 'itm' | 'otm' {
  if (atm == null) return 'otm';
  const near = Math.abs(strike - atm) < 1e-6;
  if (near) return 'atm';
  if (kind === 'call-credit') {
    // Calls: ITM when strike < spot
    return strike < atm ? 'itm' : 'otm';
  }
  // Puts: ITM when strike > spot
  return strike > atm ? 'itm' : 'otm';
}

export default function SpreadBuilderPanel({
  kind,
  onKindChange,
  strikes,
  atmStrike,
  shortStrike,
  longStrike,
  onShortChange,
  onLongChange,
  riskFreeRate,
  T,
}: Props) {
  const orderedStrikes = [...strikes]
    .map((s) => s.strike)
    .sort((a, b) => a - b);

  const shortError =
    shortStrike != null &&
    longStrike != null &&
    !isValidLegOrder(kind, shortStrike, longStrike)
      ? legOrderHint(kind)
      : null;

  return (
    <div className={styles.panel}>
      <div className={styles.block}>
        <div className={styles.label}>Strategy</div>
        <div className={styles.kindToggle} role="tablist">
          <button
            role="tab"
            aria-selected={kind === 'call-credit'}
            data-active={kind === 'call-credit'}
            onClick={() => onKindChange('call-credit')}
            className={styles.kindBtn}
          >
            Call Credit
          </button>
          <button
            role="tab"
            aria-selected={kind === 'put-credit'}
            data-active={kind === 'put-credit'}
            onClick={() => onKindChange('put-credit')}
            className={styles.kindBtn}
          >
            Put Credit
          </button>
        </div>
        <p className={styles.hint}>{kindHint(kind)}</p>
      </div>

      <div className={styles.block}>
        <div className={styles.label}>Short leg (sell)</div>
        <StrikeSelect
          value={shortStrike}
          onChange={onShortChange}
          strikes={orderedStrikes}
          atmStrike={atmStrike}
          kind={kind}
        />
      </div>

      <div className={styles.block}>
        <div className={styles.label}>Long leg (buy)</div>
        <StrikeSelect
          value={longStrike}
          onChange={onLongChange}
          strikes={orderedStrikes}
          atmStrike={atmStrike}
          kind={kind}
        />
      </div>

      {shortError && <div className={styles.error}>{shortError}</div>}

      <div className={styles.paramRow}>
        <div className={styles.paramLabel}>r</div>
        <div className={styles.paramValue}>{(riskFreeRate * 100).toFixed(0)}%</div>
      </div>
      {T != null && (
        <div className={styles.paramRow}>
          <div className={styles.paramLabel}>T</div>
          <div className={styles.paramValue}>{T.toFixed(3)} yrs</div>
        </div>
      )}
    </div>
  );
}

interface StrikeSelectProps {
  value: number | null;
  onChange: (s: number | null) => void;
  strikes: number[];
  atmStrike: number | null;
  kind: SpreadKind;
}

function StrikeSelect({ value, onChange, strikes, atmStrike, kind }: StrikeSelectProps) {
  return (
    <select
      className={styles.select}
      value={value ?? ''}
      onChange={(e) => {
        const v = e.target.value;
        onChange(v === '' ? null : Number(v));
      }}
    >
      <option value="">— select strike —</option>
      {strikes.map((s) => {
        const m = moneyness(s, atmStrike, kind);
        const label = `${s.toLocaleString()}  ${m === 'atm' ? '· ATM' : m === 'itm' ? '· ITM' : '· OTM'}`;
        return (
          <option key={s} value={s} data-moneyness={m}>
            {label}
          </option>
        );
      })}
    </select>
  );
}

function isValidLegOrder(kind: SpreadKind, shortStrike: number, longStrike: number): boolean {
  if (kind === 'call-credit') return longStrike > shortStrike;
  return longStrike < shortStrike;
}

function legOrderHint(kind: SpreadKind): string {
  if (kind === 'call-credit') return 'Call credit: long strike must be ABOVE short strike.';
  return 'Put credit: long strike must be BELOW short strike.';
}

function kindHint(kind: SpreadKind): string {
  return kind === 'call-credit'
    ? 'Bearish/neutral. Sell lower strike call, buy higher strike call. Profit if BTC stays below short strike.'
    : 'Bullish/neutral. Sell higher strike put, buy lower strike put. Profit if BTC stays above short strike.';
}
