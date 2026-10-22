import { useState } from 'react';

import { createThesis } from './api';
import { useThesisRefresh } from './hooks';
import { type ThesisFieldValues, ThesisFields, validateThesisFields } from './ThesisFields';
import styles from './Thesis.module.css';

interface ThesisCreateFormProps {
  underlying: string;
  initial: ThesisFieldValues;
  expiryOptions: string[];
  spotUsd: number | null;
  onClose: () => void;
}

export default function ThesisCreateForm({
  underlying,
  initial,
  expiryOptions,
  spotUsd,
  onClose,
}: ThesisCreateFormProps) {
  const refresh = useThesisRefresh();
  const [values, setValues] = useState(initial);
  const [share, setShare] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const invalid = validateThesisFields(values, spotUsd);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createThesis({
        underlying,
        direction: values.direction,
        horizonExpiry: values.horizonExpiry,
        level: Number(values.level),
        confirmSec: values.confirmSec,
        reason: values.reason.trim(),
        share,
      });
      await refresh();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the thesis');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.card}>
      <div className={styles.cardTitle}>Set your {underlying} thesis</div>
      <ThesisFields values={values} onChange={setValues} expiryOptions={expiryOptions} />
      <label className={styles.shareToggle}>
        <input type="checkbox" checked={share} onChange={(event) => setShare(event.target.checked)} />
        <span>Share on Social under your username</span>
      </label>
      {error && <div className={styles.error}>{error}</div>}
      <div className={styles.actions}>
        <button type="button" className={styles.primaryBtn} onClick={() => void submit()} disabled={busy}>
          {busy ? 'Saving…' : 'Save thesis'}
        </button>
        <button type="button" className={styles.ghostBtn} onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}
