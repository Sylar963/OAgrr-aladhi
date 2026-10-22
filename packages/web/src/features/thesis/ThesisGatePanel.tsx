import type { ThesisGateCheckResponse, ThesisView } from '@oggregator/protocol';
import { useLocale, useT } from '@lib/i18n';
import { useState } from 'react';

import { keepThesis, waitThesis } from './api';
import FlipForm from './FlipForm';
import {
  classificationLabel,
  diffLabel,
  fmtAge,
  fmtDiffValue,
  fmtDuration,
  fmtExpiry,
  fmtPrice,
  fmtUsdSigned,
  statusLabel,
  wrongIfText,
} from './format';
import { useThesisRefresh } from './hooks';
import { thesisMessages } from './i18n';
import styles from './Thesis.module.css';

interface ThesisGatePanelProps {
  gate: ThesisGateCheckResponse & { view: ThesisView };
  underlying: string;
  expiryOptions: string[];
  /** Suggested level for the new thesis when flipping (the structure's break-even on its losing side). */
  flipLevel: string;
}

function DiffTable({ view }: { view: ThesisView }) {
  const t = useT(thesisMessages);
  const locale = useLocale();
  if (view.diff == null) return null;
  return (
    <table className={styles.diffTable}>
      <thead>
        <tr>
          <th>{t('sinceYouWrote')}</th>
          <th>{t('then')}</th>
          <th>{t('now')}</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {view.diff.rows.map((row) => (
          <tr key={row.key} data-material={row.material === true || undefined}>
            <td>{diffLabel(row.key, locale)}</td>
            <td>{fmtDiffValue(row.key, row.before)}</td>
            <td>{fmtDiffValue(row.key, row.after)}</td>
            <td>{row.material == null ? t('na') : row.material ? t('changed') : t('same')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function ThesisGatePanel({ gate, underlying, expiryOptions, flipLevel }: ThesisGatePanelProps) {
  const t = useT(thesisMessages);
  const locale = useLocale();
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
      setError(err instanceof Error ? err.message : t('requestFailed'));
    } finally {
      setBusy(false);
    }
  }

  if (mode === 'kept') {
    return (
      <div className={styles.keptBar} role="status">
        <span className={styles.keptDot} />
        {t('keptBar')}
        <button type="button" className={styles.linkBtn} onClick={() => setMode('choose')}>
          {t('showWhy')}
        </button>
      </div>
    );
  }

  const room = status.roomPct;
  const roomText =
    status.spotUsd == null || room == null
      ? null
      : t((thesis.direction === 'bearish') === room >= 0 ? 'roomBelow' : 'roomAbove', {
          spot: fmtPrice(status.spotUsd),
          pct: Math.abs(room * 100).toFixed(1),
          level: fmtPrice(thesis.level),
        });
  const direction = classificationLabel(thesis.direction, locale);
  const expiryLabel = fmtExpiry(thesis.horizonExpiry, locale);

  return (
    <section className={styles.gate} aria-label={t('thesisGate')}>
      <div className={styles.gateHeader}>
        <span className={styles.gateTag}>{t('thesisGate')}</span>
        {reversal
          ? t('reversalHeader', {
              direction,
              underlying,
              age: fmtAge(thesis.endedAt ?? thesis.createdAt, locale),
            })
          : t('againstHeader', { target: classificationLabel(target, locale), direction, underlying })}
      </div>

      <blockquote className={styles.quote}>
        <span className={styles.quoteMeta}>{t('youWrote', { age: fmtAge(thesis.createdAt, locale) })}</span>{' '}
        <strong className={styles.direction} data-direction={thesis.direction}>
          {thesis.direction === 'bearish' ? t('bearish') : t('bullish')} {underlying}
        </strong>{' '}
        {t('quoteUntil', { date: expiryLabel })} “{thesis.reason}”{' '}
        {t('quoteWrongIf', { rule: wrongIfText(thesis.direction, thesis.level, thesis.confirmSec, locale) })}
      </blockquote>

      {!reversal && (
        <div className={styles.statusLine}>
          <span className={styles.statusChip} data-status={status.status}>
            {statusLabel(status.status, locale)}
          </span>
          {roomText && <span>{roomText}</span>}
          <span>{t('left', { d: fmtDuration(status.msToHorizon) })}</span>
        </div>
      )}

      {!reversal && <DiffTable view={view} />}

      <div className={styles.structureLine}>
        {t('structureUpDown', {
          up: fmtUsdSigned(gate.proposed.upPnlUsd),
          down: fmtUsdSigned(gate.proposed.downPnlUsd),
        })}
        {gate.proposed.movePct != null && ` ${t('structureMove', { pct: gate.proposed.movePct.toFixed(1) })}`}{' '}
        {t('structureBy', { date: expiryLabel })}{' '}
        <strong>{classificationLabel(gate.proposed.classification, locale)}</strong>.
        {gate.heldBookNote && <span className={styles.note}> {gate.heldBookNote}</span>}
      </div>

      {!reversal && view.diff != null && (
        <div className={styles.verdict}>
          {t('verdict', { m: view.diff.materialCount, n: view.diff.comparedCount })}
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
            {t('keepThesis')}
          </button>
          {!reversal &&
            (waitRunning && view.cooldown ? (
              <span className={styles.waitNote}>
                {t('waitingLeft', { d: fmtDuration(view.cooldown.endsAt - Date.now()) })}
              </span>
            ) : view.waitCompleted ? null : (
              <button
                type="button"
                className={styles.ghostBtn}
                disabled={busy}
                onClick={() => void run(() => waitThesis(thesis.id), 'choose')}
              >
                {t('wait24h')}
              </button>
            ))}
          <button type="button" className={styles.ghostBtn} disabled={busy} onClick={() => setMode('flip')}>
            {view.waitCompleted ? t('flipWaitFinished') : t('flipNow')}
          </button>
        </div>
      )}
    </section>
  );
}
