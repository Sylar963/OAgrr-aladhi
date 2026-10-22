import {
  PORTFOLIO_ASSISTANT_FEEDBACK_NOTE_MAX_CHARS,
  type PortfolioAssistantFeedback as PortfolioAssistantFeedbackValue,
  type PortfolioAssistantFeedbackReason,
  type PortfolioAssistantFeedbackVote,
} from '@oggregator/protocol';
import { useState } from 'react';

import { defineMessages, useLocale, useT } from '@lib/i18n';

import { useSubmitPortfolioAssistantFeedback } from './hooks';
import { assistantErrorFrom } from './i18n';
import styles from './PortfolioAssistantPanel.module.css';

const messages = defineMessages(
  {
    reason_wrong_numbers: 'Wrong numbers',
    reason_did_not_answer: "Didn't answer",
    reason_too_long: 'Too long',
    reason_refused: 'Refused',
    reason_other: 'Other',
    helpful: 'Helpful',
    notHelpful: 'Not helpful',
    thanks: 'Thanks for the feedback',
    whatWentWrong: 'What went wrong? (optional)',
    noteLabel: 'Feedback note',
    notePlaceholder: 'Add a short note',
    close: 'Close',
    send: 'Send',
  },
  {
    reason_wrong_numbers: 'Números incorrectos',
    reason_did_not_answer: 'No respondió',
    reason_too_long: 'Demasiado largo',
    reason_refused: 'Se negó',
    reason_other: 'Otro',
    helpful: 'Útil',
    notHelpful: 'No útil',
    thanks: 'Gracias por tu opinión',
    whatWentWrong: '¿Qué salió mal? (opcional)',
    noteLabel: 'Nota de feedback',
    notePlaceholder: 'Agrega una nota breve',
    close: 'Cerrar',
    send: 'Enviar',
  },
);

const REASONS: PortfolioAssistantFeedbackReason[] = [
  'wrong_numbers',
  'did_not_answer',
  'too_long',
  'refused',
  'other',
];

interface PortfolioAssistantFeedbackProps {
  threadId: string;
  messageId: string;
  feedback: PortfolioAssistantFeedbackValue | undefined;
}

export function PortfolioAssistantFeedback({
  threadId,
  messageId,
  feedback,
}: PortfolioAssistantFeedbackProps) {
  const t = useT(messages);
  const locale = useLocale();
  const submit = useSubmitPortfolioAssistantFeedback(threadId, messageId);
  const [open, setOpen] = useState(false);
  const [reasons, setReasons] = useState<PortfolioAssistantFeedbackReason[]>([]);
  const [note, setNote] = useState('');
  const [saved, setSaved] = useState(false);

  const pendingVote = submit.isPending ? submit.variables?.vote : undefined;
  const vote: PortfolioAssistantFeedbackVote | undefined = pendingVote ?? feedback?.vote;

  const voteUp = () => {
    setOpen(false);
    setSaved(false);
    submit.mutate({ vote: 'up' }, { onSuccess: () => setSaved(true) });
  };

  const voteDown = () => {
    setSaved(false);
    setOpen(true);
    if (feedback?.vote === 'down') {
      setReasons(feedback.reasons);
      setNote(feedback.note ?? '');
    } else {
      setReasons([]);
      setNote('');
      submit.mutate({ vote: 'down', reasons: [] });
    }
  };

  const toggleReason = (reason: PortfolioAssistantFeedbackReason) =>
    setReasons((current) =>
      current.includes(reason) ? current.filter((item) => item !== reason) : [...current, reason],
    );

  const sendDetails = () => {
    const trimmed = note.trim();
    submit.mutate(
      { vote: 'down', reasons, ...(trimmed ? { note: trimmed } : {}) },
      {
        onSuccess: () => {
          setOpen(false);
          setSaved(true);
        },
      },
    );
  };

  return (
    <div className={styles.feedback}>
      <div className={styles.feedbackVotes}>
        <button
          type="button"
          className={styles.feedbackVote}
          aria-label={t('helpful')}
          title={t('helpful')}
          aria-pressed={vote === 'up'}
          disabled={submit.isPending}
          onClick={voteUp}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M5 7v6.5H2.5V7H5zm0 0l2.6-4.8a1.3 1.3 0 0 1 2.3 1.1L9.2 6H13a1.3 1.3 0 0 1 1.3 1.5l-.9 4.9a1.3 1.3 0 0 1-1.3 1.1H5" />
          </svg>
        </button>
        <button
          type="button"
          className={styles.feedbackVote}
          aria-label={t('notHelpful')}
          title={t('notHelpful')}
          aria-pressed={vote === 'down'}
          aria-expanded={open}
          disabled={submit.isPending}
          onClick={voteDown}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M11 9V2.5h2.5V9H11zm0 0l-2.6 4.8a1.3 1.3 0 0 1-2.3-1.1L6.8 10H3a1.3 1.3 0 0 1-1.3-1.5l.9-4.9A1.3 1.3 0 0 1 3.9 2.5H11" />
          </svg>
        </button>
        {saved && !open && <span className={styles.feedbackStatus}>{t('thanks')}</span>}
        {submit.isError && (
          <span className={styles.feedbackStatus} data-tone="error" role="alert">
            {assistantErrorFrom(submit.error, 'request_failed', locale)}
          </span>
        )}
      </div>
      {open && (
        <fieldset className={styles.feedbackDetails}>
          <legend>{t('whatWentWrong')}</legend>
          <div className={styles.feedbackChips}>
            {REASONS.map((reason) => (
              <button
                key={reason}
                type="button"
                aria-pressed={reasons.includes(reason)}
                onClick={() => toggleReason(reason)}
              >
                {t(`reason_${reason}`)}
              </button>
            ))}
          </div>
          <input
            type="text"
            aria-label={t('noteLabel')}
            placeholder={t('notePlaceholder')}
            maxLength={PORTFOLIO_ASSISTANT_FEEDBACK_NOTE_MAX_CHARS}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <div className={styles.feedbackActions}>
            <span>
              {note.length}/{PORTFOLIO_ASSISTANT_FEEDBACK_NOTE_MAX_CHARS}
            </span>
            <button type="button" onClick={() => setOpen(false)}>
              {t('close')}
            </button>
            <button type="button" disabled={submit.isPending} onClick={sendDetails}>
              {t('send')}
            </button>
          </div>
        </fieldset>
      )}
    </div>
  );
}
