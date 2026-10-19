import {
  THESIS_MIN_REASON_CHARS,
  type ThesisConfirmSec,
  type ThesisDirection,
} from '@oggregator/protocol';

import { fmtExpiry, fmtPrice } from './format';
import styles from './Thesis.module.css';

export interface ThesisFieldValues {
  direction: ThesisDirection;
  horizonExpiry: string;
  level: string;
  confirmSec: ThesisConfirmSec;
  reason: string;
}

export function validateThesisFields(values: ThesisFieldValues, spotUsd: number | null): string | null {
  const level = Number(values.level);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.horizonExpiry)) return 'Pick a horizon expiry.';
  if (!(level > 0)) return 'Enter the invalidation level.';
  if (spotUsd != null && values.direction === 'bearish' && level <= spotUsd) {
    return `A bearish thesis is wrong above spot: set the level above ${fmtPrice(spotUsd)}.`;
  }
  if (spotUsd != null && values.direction === 'bullish' && level >= spotUsd) {
    return `A bullish thesis is wrong below spot: set the level below ${fmtPrice(spotUsd)}.`;
  }
  if (values.reason.trim().length < THESIS_MIN_REASON_CHARS) {
    return `Write the reason (at least ${THESIS_MIN_REASON_CHARS} characters).`;
  }
  return null;
}

interface ThesisFieldsProps {
  values: ThesisFieldValues;
  onChange: (values: ThesisFieldValues) => void;
  expiryOptions: string[];
  /** A flip fixes the direction to the opposite of the thesis it replaces. */
  lockDirection?: boolean;
}

export function ThesisFields({ values, onChange, expiryOptions, lockDirection = false }: ThesisFieldsProps) {
  const set = <K extends keyof ThesisFieldValues>(key: K, value: ThesisFieldValues[K]) =>
    onChange({ ...values, [key]: value });
  const expiries = expiryOptions.includes(values.horizonExpiry) || values.horizonExpiry === ''
    ? expiryOptions
    : [values.horizonExpiry, ...expiryOptions];

  return (
    <div className={styles.fields}>
      <div className={styles.fieldRow}>
        <span className={styles.fieldLabel}>View</span>
        <div className={styles.segment} role="radiogroup" aria-label="Direction">
          {(['bearish', 'bullish'] as const).map((direction) => (
            <button
              key={direction}
              type="button"
              className={styles.segmentBtn}
              data-active={values.direction === direction || undefined}
              data-direction={direction}
              disabled={lockDirection && values.direction !== direction}
              onClick={() => set('direction', direction)}
            >
              {direction === 'bearish' ? 'Bearish' : 'Bullish'}
            </button>
          ))}
        </div>
      </div>
      <label className={styles.fieldRow}>
        <span className={styles.fieldLabel}>Until</span>
        {expiries.length > 0 ? (
          <select
            className={styles.input}
            value={values.horizonExpiry}
            onChange={(event) => set('horizonExpiry', event.target.value)}
          >
            {values.horizonExpiry === '' && <option value="">Pick expiry</option>}
            {expiries.map((expiry) => (
              <option key={expiry} value={expiry}>
                {fmtExpiry(expiry)} ({expiry})
              </option>
            ))}
          </select>
        ) : (
          <input
            className={styles.input}
            type="date"
            value={values.horizonExpiry}
            onChange={(event) => set('horizonExpiry', event.target.value)}
          />
        )}
      </label>
      <label className={styles.fieldRow}>
        <span className={styles.fieldLabel}>
          I'm wrong if a
        </span>
        <span className={styles.inline}>
          <select
            className={styles.inputSmall}
            value={values.confirmSec}
            onChange={(event) => set('confirmSec', Number(event.target.value) as ThesisConfirmSec)}
          >
            <option value={86400}>1D</option>
            <option value={14400}>4H</option>
          </select>
          <span className={styles.fieldText}>
            candle closes {values.direction === 'bearish' ? 'above' : 'below'}
          </span>
          <input
            className={styles.inputSmall}
            inputMode="decimal"
            value={values.level}
            placeholder="level"
            onChange={(event) => set('level', event.target.value.replace(/[^\d.]/g, ''))}
          />
        </span>
      </label>
      <label className={styles.fieldColumn}>
        <span className={styles.fieldLabel}>Because</span>
        <textarea
          className={styles.textarea}
          rows={2}
          value={values.reason}
          placeholder="What you expect and why, in your own words. You will read this back before you flip."
          onChange={(event) => set('reason', event.target.value)}
        />
      </label>
    </div>
  );
}
