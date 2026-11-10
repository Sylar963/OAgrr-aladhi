import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  AlphaEvaluationOutcomeSchema,
  type AlphaEvaluationOutcome,
  type AlphaEvaluationResponse,
} from '@oggregator/protocol';
import { fmtUsd } from '@lib/format';
import { useT } from '@lib/i18n';
import { evaluationMessages } from './evaluation-messages';
import {
  readEvaluationJournal,
  removeEvaluation,
  saveEvaluationOutcome,
} from './evaluation-journal';
import styles from './AlphaEvaluationPanel.module.css';

export default function AlphaEvaluationJournal() {
  const t = useT(evaluationMessages);
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const journal = useQuery({
    queryKey: ['alpha', 'evaluation-journal'],
    queryFn: readEvaluationJournal,
    enabled: open,
    retry: false,
    staleTime: 0,
  });
  const remove = useMutation({
    mutationFn: removeEvaluation,
    onSuccess: () => client.invalidateQueries({ queryKey: ['alpha', 'evaluation-journal'] }),
    retry: false,
  });
  const download = useMutation({
    mutationFn: async () => {
      const data = await readEvaluationJournal();
      const exportedAt = new Date().toISOString();
      const blob = new Blob(
        [JSON.stringify({ version: 1, exportedAt, source: 'browser-journal', ...data }, null, 2)],
        { type: 'application/json' },
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `alpha-evaluations-${exportedAt.slice(0, 10)}.json`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    },
    retry: false,
  });
  return (
    <details className={styles.panel} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        {t('journal')}
        {journal.data ? ` · ${journal.data.evaluations.length}` : ''}
      </summary>
      <div className={styles.body}>
        <p>{t('journalIntro')}</p>
        <div className={styles.actions}>
          <button type="button" disabled={download.isPending} onClick={() => download.mutate()}>
            {t('export')}
          </button>
        </div>
        {(journal.error || remove.error || download.error) && (
          <p role="alert" className={styles.error}>
            {(journal.error || remove.error || download.error)?.message}
          </p>
        )}
        {journal.data?.evaluations.length === 0 && <p>{t('empty')}</p>}
        {journal.data?.evaluations.map((evaluation) => {
          const outcome = journal.data.outcomes.find(
            (entry) => entry.evaluationId === evaluation.id,
          );
          return (
            <details key={evaluation.id} className={styles.journalEntry}>
              <summary>
                {evaluation.request.candidate.underlying} · {evaluation.request.candidate.strategy}{' '}
                · {new Date(evaluation.evaluatedAt).toLocaleString()}
              </summary>
              <p>
                {t('savedAt')}: {new Date(evaluation.savedAt).toLocaleString()}
                <br />
                {evaluation.request.candidate.legs
                  .map((leg) => `${leg.side} ${leg.quantity} ${leg.venue} ${leg.instrument}`)
                  .join(' / ')}
              </p>
              <p>
                {t('thesis')}: {evaluation.request.thesis || '—'}
                <br />
                {t('invalidation')}: {evaluation.request.invalidation || '—'}
              </p>
              <p>
                {t('expected')}: {fmtUsd(evaluation.scenario?.expectedPnl ?? null)} ·{' '}
                {t('evidence')}
              </p>
              {outcome ? (
                <p>
                  {t('reported')} ·{' '}
                  {t(
                    outcome.kind === 'expiry'
                      ? 'expiry'
                      : outcome.kind === 'early-exit'
                        ? 'early'
                        : 'skipped',
                  )}{' '}
                  · {fmtUsd(outcome.netPnl)}
                  <br />
                  {new Date(outcome.closedAt).toLocaleString()} · {outcome.note}
                </p>
              ) : (
                <OutcomeForm evaluation={evaluation} />
              )}
              <div className={styles.actions}>
                <button
                  type="button"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(evaluation.id)}
                >
                  {t('remove')}
                </button>
              </div>
            </details>
          );
        })}
        <p>{t('noTrades')}</p>
      </div>
    </details>
  );
}

function OutcomeForm({ evaluation }: { evaluation: AlphaEvaluationResponse }) {
  const t = useT(evaluationMessages);
  const client = useQueryClient();
  const [kind, setKind] = useState<AlphaEvaluationOutcome['kind']>('early-exit');
  const [closed, setClosed] = useState('');
  const [pnl, setPnl] = useState('');
  const [settlement, setSettlement] = useState('');
  const [note, setNote] = useState('');
  const [invalid, setInvalid] = useState(false);
  const save = useMutation({
    mutationFn: saveEvaluationOutcome,
    onSuccess: () => client.invalidateQueries({ queryKey: ['alpha', 'evaluation-journal'] }),
    retry: false,
  });
  function submit() {
    const parsed = AlphaEvaluationOutcomeSchema.safeParse({
      evaluationId: evaluation.id,
      recordedAt: Date.now(),
      closedAt: new Date(closed).getTime(),
      kind,
      netPnl: kind === 'not-traded' || pnl.trim() === '' ? null : Number(pnl),
      settlementPrice: kind === 'expiry' && settlement.trim() !== '' ? Number(settlement) : null,
      note,
    });
    setInvalid(!parsed.success);
    if (parsed.success) save.mutate(parsed.data);
  }
  return (
    <details>
      <summary>{t('outcome')}</summary>
      <div className={styles.form}>
        <label className={styles.field}>
          {t('kind')}
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as AlphaEvaluationOutcome['kind'])}
          >
            <option value="expiry">{t('expiry')}</option>
            <option value="early-exit">{t('early')}</option>
            <option value="not-traded">{t('skipped')}</option>
          </select>
        </label>
        <label className={styles.field}>
          {t('closed')}
          <input
            type="datetime-local"
            step="1"
            value={closed}
            onChange={(e) => setClosed(e.target.value)}
          />
        </label>
        {kind !== 'not-traded' && (
          <label className={styles.field}>
            {t('pnl')}
            <input type="number" step="any" value={pnl} onChange={(e) => setPnl(e.target.value)} />
          </label>
        )}
        {kind === 'expiry' && (
          <label className={styles.field}>
            {t('settlement')}
            <input
              type="number"
              min="0"
              step="any"
              value={settlement}
              onChange={(e) => setSettlement(e.target.value)}
            />
          </label>
        )}
        <label className={styles.field}>
          {t('note')}
          <textarea maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      <div className={styles.actions}>
        <button type="button" disabled={save.isPending} onClick={submit}>
          {t('saveOutcome')}
        </button>
      </div>
      {invalid && (
        <p role="alert" className={styles.error}>
          {t('invalid')}
        </p>
      )}
      {save.error && (
        <p role="alert" className={styles.error}>
          {save.error.message}
        </p>
      )}
    </details>
  );
}
