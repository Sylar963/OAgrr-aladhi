import { useLocale, useT } from '@lib/i18n';
import { useState } from 'react';

import { endThesis, shareThesis, tightenThesis } from './api';
import type { UnderlyingThesis } from './hooks';
import { useThesisRefresh } from './hooks';
import { classificationLabel, fmtDuration, fmtExpiry, fmtPrice, statusLabel, wrongIfText } from './format';
import { thesisMessages } from './i18n';
import styles from './Thesis.module.css';

interface ThesisStripProps extends UnderlyingThesis {
  underlying: string;
  onSetThesis: () => void;
}

export default function ThesisStrip({ underlying, active, reversal, recentlyEnded, onSetThesis }: ThesisStripProps) {
  const t = useT(thesisMessages);
  const locale = useLocale();
  const refresh = useThesisRefresh();
  const [editing, setEditing] = useState<'tighten' | 'end' | null>(null);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function toggleEditor(next: 'tighten' | 'end') {
    setEditing(editing === next ? null : next);
    setInput('');
    setError(null);
  }

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await refresh();
      setEditing(null);
      setInput('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('requestFailed'));
    } finally {
      setBusy(false);
    }
  }

  if (active == null) {
    return (
      <div className={styles.strip}>
        <span className={styles.stripLabel}>{t('thesis')}</span>
        {reversal?.cooldown ? (
          <span className={styles.stripText}>
            {t('endedCooldown', {
              direction: classificationLabel(reversal.thesis.direction, locale),
              d: fmtDuration(reversal.cooldown.endsAt - Date.now()),
            })}
          </span>
        ) : recentlyEnded != null && recentlyEnded.state !== 'active' ? (
          <span className={styles.stripText}>
            {t(`ended_${recentlyEnded.state}`, { underlying })}
          </span>
        ) : (
          <span className={styles.stripText}>{t('noThesis', { underlying })}</span>
        )}
        <button type="button" className={styles.stripBtn} onClick={onSetThesis}>
          {t('setThesis')}
        </button>
      </div>
    );
  }

  const { thesis, status, cooldown } = active;
  const nothingToDo = status.status === 'INTACT' && active.pendingFlip == null;
  return (
    <div className={styles.stripWrap}>
      <div className={styles.strip}>
        <span className={styles.stripLabel}>{t('thesis')}</span>
        <span className={styles.direction} data-direction={thesis.direction}>
          {thesis.direction === 'bearish' ? t('bearish') : t('bullish')}
        </span>
        <span className={styles.stripText}>
          {t('untilWrongIf', {
            date: fmtExpiry(thesis.horizonExpiry, locale),
            rule: wrongIfText(thesis.direction, thesis.level, thesis.confirmSec, locale),
          })}
        </span>
        <span className={styles.statusChip} data-status={status.status}>
          {statusLabel(status.status, locale)}
        </span>
        {status.roomPct != null && (
          <span className={styles.stripText}>{t('room', { pct: (status.roomPct * 100).toFixed(1) })}</span>
        )}
        <span className={styles.stripText}>{t('left', { d: fmtDuration(status.msToHorizon) })}</span>
        {cooldown?.kind === 'wait' && !cooldown.completed && (
          <span className={styles.stripText}>{t('wait', { d: fmtDuration(cooldown.endsAt - Date.now()) })}</span>
        )}
        {nothingToDo && <span className={styles.nothing}>{t('nothingToDo')}</span>}
        {active.books?.filter((book) => book.state !== 'empty').map((book) => (
          <span key={book.source} className={styles.stripText}>
            {t(`book_${book.state}`, { source: book.source, count: book.openLegCount })}
          </span>
        ))}
        <span className={styles.stripSpacer} />
        <button
          type="button"
          className={styles.stripBtn}
          data-shared={thesis.share != null || undefined}
          disabled={busy}
          title={thesis.share != null ? t('sharedTitle') : t('shareTitle')}
          onClick={() => void run(() => shareThesis(thesis.id, thesis.share == null))}
        >
          {thesis.share != null ? t('shared') : t('share')}
        </button>
        <button type="button" className={styles.stripBtn} disabled={busy} onClick={() => toggleEditor('tighten')}>
          {t('tighten')}
        </button>
        <button type="button" className={styles.stripBtn} disabled={busy} onClick={() => toggleEditor('end')}>
          {t('end')}
        </button>
      </div>
      {editing === 'tighten' && (
        <div className={styles.stripEdit}>
          <span className={styles.stripText}>
            {t('newLevel', { spot: fmtPrice(status.spotUsd) })}
          </span>
          <input
            className={styles.inputSmall}
            aria-label={t('tighten')}
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
            {t('save')}
          </button>
          <span className={styles.stripText}>{t('tightenFutureCloses')}</span>
        </div>
      )}
      {editing === 'end' && (
        <div className={styles.stripEdit}>
          <span className={styles.stripText}>
            {t('endHint')}
          </span>
          <input
            className={styles.input}
            placeholder={t('notePlaceholder')}
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
          <button
            type="button"
            className={styles.stripBtn}
            disabled={busy}
            onClick={() => void run(() => endThesis(thesis.id, input.trim() || undefined))}
          >
            {t('endThesis')}
          </button>
        </div>
      )}
      {error && <div className={styles.error}>{error}</div>}
    </div>
  );
}
