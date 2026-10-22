import {
  THESIS_FLIP_CONFIRMATION,
  THESIS_MIN_FLIP_REASON_CHARS,
  type ThesisRecord,
} from '@oggregator/protocol';
import { useLocale, useT } from '@lib/i18n';
import { useState } from 'react';

import { flipThesis } from './api';
import { useThesisRefresh } from './hooks';
import { thesisMessages } from './i18n';
import { type ThesisFieldValues, ThesisFields, validateThesisFields } from './ThesisFields';
import styles from './Thesis.module.css';

interface FlipFormProps {
  thesis: ThesisRecord;
  /** A finished wait removes the typed confirmation. */
  needsConfirmation: boolean;
  /** Logging a flip the held-book monitor already saw. */
  late?: boolean;
  initialLevel: string;
  expiryOptions: string[];
  spotUsd: number | null;
  onCancel: () => void;
  onDone: () => void;
}

export default function FlipForm({
  thesis,
  needsConfirmation,
  late = false,
  initialLevel,
  expiryOptions,
  spotUsd,
  onCancel,
  onDone,
}: FlipFormProps) {
  const t = useT(thesisMessages);
  const locale = useLocale();
  const refresh = useThesisRefresh();
  const [reason, setReason] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [values, setValues] = useState<ThesisFieldValues>({
    direction: thesis.direction === 'bearish' ? 'bullish' : 'bearish',
    horizonExpiry: expiryOptions.find((expiry) => expiry >= thesis.horizonExpiry) ?? thesis.horizonExpiry,
    level: initialLevel,
    confirmSec: thesis.confirmSec,
    reason: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (reason.trim().length < THESIS_MIN_FLIP_REASON_CHARS) {
      setError(t('sayWhatChanged', { n: THESIS_MIN_FLIP_REASON_CHARS }));
      return;
    }
    if (needsConfirmation && confirmation.trim() !== THESIS_FLIP_CONFIRMATION) {
      setError(t('typeExactly', { phrase: THESIS_FLIP_CONFIRMATION }));
      return;
    }
    const invalid = validateThesisFields(values, spotUsd, locale);
    if (invalid) {
      setError(t('newThesisError', { error: invalid }));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await flipThesis(thesis.id, {
        reason: reason.trim(),
        ...(needsConfirmation ? { confirmation: confirmation.trim() } : {}),
        ...(late ? { late: true } : {}),
        newThesis: {
          direction: values.direction,
          horizonExpiry: values.horizonExpiry,
          level: Number(values.level),
          confirmSec: values.confirmSec,
          reason: values.reason.trim(),
        },
      });
      await refresh();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('flipFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.flipForm}>
      <label className={styles.fieldColumn}>
        <span className={styles.fieldLabel}>{t('whatChanged')}</span>
        <textarea
          className={styles.textarea}
          rows={2}
          value={reason}
          placeholder={t('whatChangedPlaceholder')}
          onChange={(event) => setReason(event.target.value)}
        />
        <span className={styles.counter}>
          {reason.trim().length}/{THESIS_MIN_FLIP_REASON_CHARS}
        </span>
      </label>
      <div className={styles.cardSubtitle}>{t('newThesisSubtitle')}</div>
      <ThesisFields values={values} onChange={setValues} expiryOptions={expiryOptions} lockDirection />
      {needsConfirmation && (
        <label className={styles.fieldColumn}>
          <span className={styles.fieldLabel}>
            {t('type')} <code className={styles.code}>{THESIS_FLIP_CONFIRMATION}</code>
          </span>
          <input
            className={styles.input}
            value={confirmation}
            autoComplete="off"
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </label>
      )}
      {error && <div className={styles.error}>{error}</div>}
      <div className={styles.actions}>
        <button type="button" className={styles.dangerBtn} onClick={() => void submit()} disabled={busy}>
          {busy ? t('flipping') : late ? t('logTheFlip') : t('flip')}
        </button>
        <button type="button" className={styles.ghostBtn} onClick={onCancel} disabled={busy}>
          {t('back')}
        </button>
      </div>
    </div>
  );
}
