import { useState } from 'react';

import { endThesis, tightenThesis } from './api';
import type { UnderlyingThesis } from './hooks';
import { useThesisRefresh } from './hooks';
import { fmtDuration, fmtExpiry, fmtPrice, STATUS_LABEL, wrongIfText } from './format';
import styles from './Thesis.module.css';

interface ThesisStripProps extends UnderlyingThesis {
  underlying: string;
  onSetThesis: () => void;
}

export default function ThesisStrip({ underlying, active, reversal, onSetThesis }: ThesisStripProps) {
  const refresh = useThesisRefresh();
  const [editing, setEditing] = useState<'tighten' | 'end' | null>(null);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await refresh();
      setEditing(null);
      setInput('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  }

  if (active == null) {
    return (
      <div className={styles.strip}>
        <span className={styles.stripLabel}>Thesis</span>
        {reversal?.cooldown ? (
          <span className={styles.stripText}>
            Ended {reversal.thesis.direction} thesis · reversal cooldown{' '}
            {fmtDuration(reversal.cooldown.endsAt - Date.now())} left
          </span>
        ) : (
          <span className={styles.stripText}>No {underlying} thesis.</span>
        )}
        <button type="button" className={styles.stripBtn} onClick={onSetThesis}>
          Set thesis
        </button>
      </div>
    );
  }

  const { thesis, status, cooldown } = active;
  const nothingToDo = status.status === 'INTACT' && active.pendingFlip == null;
  return (
    <div className={styles.stripWrap}>
      <div className={styles.strip}>
        <span className={styles.stripLabel}>Thesis</span>
        <span className={styles.direction} data-direction={thesis.direction}>
          {thesis.direction === 'bearish' ? 'Bearish' : 'Bullish'}
        </span>
        <span className={styles.stripText}>
          until {fmtExpiry(thesis.horizonExpiry)} · wrong if {wrongIfText(thesis.direction, thesis.level, thesis.confirmSec)}
        </span>
        <span className={styles.statusChip} data-status={status.status}>
          {STATUS_LABEL[status.status]}
        </span>
        {status.roomPct != null && (
          <span className={styles.stripText}>{(status.roomPct * 100).toFixed(1)}% room</span>
        )}
        <span className={styles.stripText}>{fmtDuration(status.msToHorizon)} left</span>
        {cooldown?.kind === 'wait' && !cooldown.completed && (
          <span className={styles.stripText}>wait {fmtDuration(cooldown.endsAt - Date.now())}</span>
        )}
        {nothingToDo && <span className={styles.nothing}>nothing to do</span>}
        <span className={styles.stripSpacer} />
        <button type="button" className={styles.stripBtn} onClick={() => setEditing(editing === 'tighten' ? null : 'tighten')}>
          Tighten
        </button>
        <button type="button" className={styles.stripBtn} onClick={() => setEditing(editing === 'end' ? null : 'end')}>
          End
        </button>
      </div>
      {editing === 'tighten' && (
        <div className={styles.stripEdit}>
          <span className={styles.stripText}>
            New level (only closer to spot {fmtPrice(status.spotUsd)}):
          </span>
          <input
            className={styles.inputSmall}
            inputMode="decimal"
            value={input}
            onChange={(event) => setInput(event.target.value.replace(/[^\d.]/g, ''))}
          />
          <button
            type="button"
            className={styles.stripBtn}
            disabled={busy || !(Number(input) > 0)}
            onClick={() => void run(() => tightenThesis(thesis.id, Number(input)))}
          >
            Save
          </button>
        </div>
      )}
      {editing === 'end' && (
        <div className={styles.stripEdit}>
          <span className={styles.stripText}>
            End without a new view. Taking the other side within 24h then needs the override.
          </span>
          <input
            className={styles.input}
            placeholder="Note (optional)"
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
          <button
            type="button"
            className={styles.stripBtn}
            disabled={busy}
            onClick={() => void run(() => endThesis(thesis.id, input.trim() || undefined))}
          >
            End thesis
          </button>
        </div>
      )}
      {error && <div className={styles.error}>{error}</div>}
    </div>
  );
}
