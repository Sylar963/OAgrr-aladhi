import type { ThesisGateCheckResponse, ThesisView } from '@oggregator/protocol';
import { useState } from 'react';

import { keepThesis, waitThesis } from './api';
import FlipForm from './FlipForm';
import {
  DIFF_LABEL,
  fmtAge,
  fmtDiffValue,
  fmtDuration,
  fmtExpiry,
  fmtPrice,
  fmtUsdSigned,
  STATUS_LABEL,
  wrongIfText,
} from './format';
import { useThesisRefresh } from './hooks';
import styles from './Thesis.module.css';

interface ThesisGatePanelProps {
  gate: ThesisGateCheckResponse & { view: ThesisView };
  underlying: string;
  expiryOptions: string[];
  /** Suggested level for the new thesis when flipping (the structure's break-even on its losing side). */
  flipLevel: string;
}

function DiffTable({ view }: { view: ThesisView }) {
  if (view.diff == null) return null;
  return (
    <table className={styles.diffTable}>
      <thead>
        <tr>
          <th>Since you wrote it</th>
          <th>Then</th>
          <th>Now</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {view.diff.rows.map((row) => (
          <tr key={row.key} data-material={row.material === true || undefined}>
            <td>{DIFF_LABEL[row.key]}</td>
            <td>{fmtDiffValue(row.key, row.before)}</td>
            <td>{fmtDiffValue(row.key, row.after)}</td>
            <td>{row.material == null ? 'n/a' : row.material ? 'changed' : 'same'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function ThesisGatePanel({ gate, underlying, expiryOptions, flipLevel }: ThesisGatePanelProps) {
  const refresh = useThesisRefresh();
  const [mode, setMode] = useState<'choose' | 'flip' | 'kept'>('choose');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { view } = gate;
  const { thesis, status } = view;
  const reversal = gate.reason === 'reversal_cooldown';
  const target = gate.combined?.classification ?? gate.proposed.classification;
  const waitRunning = view.cooldown?.kind === 'wait' && !view.cooldown.completed;

  async function run(action: () => Promise<unknown>, next: typeof mode) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await refresh();
      setMode(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  }

  if (mode === 'kept') {
    return (
      <div className={styles.keptBar} role="status">
        <span className={styles.keptDot} />
        Thesis intact — nothing to do. Snapshot and Send to paper stay off for this structure.
        <button type="button" className={styles.linkBtn} onClick={() => setMode('choose')}>
          Show why
        </button>
      </div>
    );
  }

  const room = status.roomPct;
  const roomText =
    status.spotUsd == null || room == null
      ? null
      : `spot ${fmtPrice(status.spotUsd)} is ${Math.abs(room * 100).toFixed(1)}% ${
          (thesis.direction === 'bearish') === room >= 0 ? 'below' : 'above'
        } ${fmtPrice(thesis.level)}`;

  return (
    <section className={styles.gate} aria-label="Thesis gate">
      <div className={styles.gateHeader}>
        <span className={styles.gateTag}>Thesis gate</span>
        {reversal
          ? `You ended your ${thesis.direction} ${underlying} thesis ${fmtAge(thesis.endedAt ?? thesis.createdAt)}. Reversing within 24h needs the override.`
          : `This ${target} structure goes against your ${thesis.direction} ${underlying} thesis.`}
      </div>

      <blockquote className={styles.quote}>
        <span className={styles.quoteMeta}>{fmtAge(thesis.createdAt)} you wrote:</span>{' '}
        <strong className={styles.direction} data-direction={thesis.direction}>
          {thesis.direction === 'bearish' ? 'Bearish' : 'Bullish'} {underlying}
        </strong>{' '}
        until {fmtExpiry(thesis.horizonExpiry)}. Because: “{thesis.reason}” I'm wrong if{' '}
        {wrongIfText(thesis.direction, thesis.level, thesis.confirmSec)}.
      </blockquote>

      {!reversal && (
        <div className={styles.statusLine}>
          <span className={styles.statusChip} data-status={status.status}>
            {STATUS_LABEL[status.status]}
          </span>
          {roomText && <span>{roomText}</span>}
          <span>{fmtDuration(status.msToHorizon)} left</span>
        </div>
      )}

      {!reversal && <DiffTable view={view} />}

      <div className={styles.structureLine}>
        This structure: up {fmtUsdSigned(gate.proposed.upPnlUsd)} / down {fmtUsdSigned(gate.proposed.downPnlUsd)}
        {gate.proposed.movePct != null && ` on a ±${gate.proposed.movePct.toFixed(1)}% move`} by{' '}
        {fmtExpiry(thesis.horizonExpiry)} → <strong>{gate.proposed.classification}</strong>.
        {gate.heldBookNote && <span className={styles.note}> {gate.heldBookNote}</span>}
      </div>

      {!reversal && view.diff != null && (
        <div className={styles.verdict}>
          {view.diff.materialCount} of {view.diff.comparedCount} changed materially. The rule you wrote has not
          fired.
        </div>
      )}

      {error && <div className={styles.error}>{error}</div>}

      {mode === 'flip' ? (
        <FlipForm
          thesis={thesis}
          needsConfirmation={!view.waitCompleted}
          initialLevel={flipLevel}
          expiryOptions={expiryOptions}
          spotUsd={status.spotUsd}
          onCancel={() => setMode('choose')}
          onDone={() => setMode('choose')}
        />
      ) : (
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primaryBtn}
            autoFocus
            disabled={busy}
            onClick={() => void run(() => keepThesis(thesis.id), 'kept')}
          >
            Keep my thesis
          </button>
          {!reversal &&
            (waitRunning && view.cooldown ? (
              <span className={styles.waitNote}>
                Waiting · {fmtDuration(view.cooldown.endsAt - Date.now())} left
              </span>
            ) : view.waitCompleted ? null : (
              <button
                type="button"
                className={styles.ghostBtn}
                disabled={busy}
                onClick={() => void run(() => waitThesis(thesis.id), 'choose')}
              >
                Wait 24h
              </button>
            ))}
          <button type="button" className={styles.ghostBtn} disabled={busy} onClick={() => setMode('flip')}>
            {view.waitCompleted ? 'Flip (wait finished)' : 'Flip now'}
          </button>
        </div>
      )}
    </section>
  );
}
