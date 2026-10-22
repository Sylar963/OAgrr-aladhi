import { type Locale, translate, useLocale, useT, type Vars } from '@lib/i18n';
import {
  THESIS_MIN_REASON_CHARS,
  type ThesisConfirmSec,
  type ThesisDirection,
} from '@oggregator/protocol';

import { fmtExpiry, fmtPrice } from './format';
import { thesisMessages } from './i18n';
import styles from './Thesis.module.css';

export interface ThesisFieldValues {
  direction: ThesisDirection;
  horizonExpiry: string;
  level: string;
  confirmSec: ThesisConfirmSec;
  reason: string;
}

export function validateThesisFields(
  values: ThesisFieldValues,
  spotUsd: number | null,
  locale: Locale,
): string | null {
  const level = Number(values.level);
  const tr = (key: keyof typeof thesisMessages.en, vars?: Vars) =>
    translate(thesisMessages, key, vars, locale);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.horizonExpiry)) return tr('pickHorizon');
  if (!(level > 0)) return tr('enterLevel');
  if (spotUsd != null && values.direction === 'bearish' && level <= spotUsd) {
    return tr('bearishLevel', { spot: fmtPrice(spotUsd) });
  }
  if (spotUsd != null && values.direction === 'bullish' && level >= spotUsd) {
    return tr('bullishLevel', { spot: fmtPrice(spotUsd) });
  }
  if (values.reason.trim().length < THESIS_MIN_REASON_CHARS) {
    return tr('writeReason', { n: THESIS_MIN_REASON_CHARS });
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
  const t = useT(thesisMessages);
  const locale = useLocale();
  const set = <K extends keyof ThesisFieldValues>(key: K, value: ThesisFieldValues[K]) =>
    onChange({ ...values, [key]: value });
  const expiries = expiryOptions.includes(values.horizonExpiry) || values.horizonExpiry === ''
    ? expiryOptions
    : [values.horizonExpiry, ...expiryOptions];

  return (
    <div className={styles.fields}>
      <div className={styles.fieldRow}>
        <span className={styles.fieldLabel}>{t('view')}</span>
        <div className={styles.segment} role="radiogroup" aria-label={t('direction')}>
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
              {direction === 'bearish' ? t('bearish') : t('bullish')}
            </button>
          ))}
        </div>
      </div>
      <label className={styles.fieldRow}>
        <span className={styles.fieldLabel}>{t('until')}</span>
        {expiries.length > 0 ? (
          <select
            className={styles.input}
            value={values.horizonExpiry}
            onChange={(event) => set('horizonExpiry', event.target.value)}
          >
            {values.horizonExpiry === '' && <option value="">{t('pickExpiry')}</option>}
            {expiries.map((expiry) => (
              <option key={expiry} value={expiry}>
                {fmtExpiry(expiry, locale)} ({expiry})
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
        <span className={styles.fieldLabel}>{t('wrongIfA')}</span>
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
            {values.direction === 'bearish' ? t('candleClosesAbove') : t('candleClosesBelow')}
          </span>
          <input
            className={styles.inputSmall}
            inputMode="decimal"
            value={values.level}
            placeholder={t('levelPlaceholder')}
            onChange={(event) => set('level', event.target.value.replace(/[^\d.]/g, ''))}
          />
        </span>
      </label>
      <label className={styles.fieldColumn}>
        <span className={styles.fieldLabel}>{t('because')}</span>
        <textarea
          className={styles.textarea}
          rows={2}
          value={values.reason}
          placeholder={t('reasonPlaceholder')}
          onChange={(event) => set('reason', event.target.value)}
        />
      </label>
    </div>
  );
}
