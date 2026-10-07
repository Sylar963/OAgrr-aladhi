import {
  PORTFOLIO_ASSISTANT_FEEDBACK_NOTE_MAX_CHARS,
  type PortfolioAssistantFeedback as PortfolioAssistantFeedbackValue,
  type PortfolioAssistantFeedbackReason,
  type PortfolioAssistantFeedbackVote,
} from '@oggregator/protocol';
import { useState } from 'react';

import { useSubmitPortfolioAssistantFeedback } from './hooks';
import styles from './PortfolioAssistantPanel.module.css';

const REASONS: Array<[PortfolioAssistantFeedbackReason, string]> = [
  ['wrong_numbers', 'Wrong numbers'],
  ['did_not_answer', "Didn't answer"],
  ['too_long', 'Too long'],
  ['refused', 'Refused'],
  ['other', 'Other'],
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
          aria-label="Helpful"
          title="Helpful"
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
          aria-label="Not helpful"
          title="Not helpful"
          aria-pressed={vote === 'down'}
          aria-expanded={open}
          disabled={submit.isPending}
          onClick={voteDown}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M11 9V2.5h2.5V9H11zm0 0l-2.6 4.8a1.3 1.3 0 0 1-2.3-1.1L6.8 10H3a1.3 1.3 0 0 1-1.3-1.5l.9-4.9A1.3 1.3 0 0 1 3.9 2.5H11" />
          </svg>
        </button>
        {saved && !open && <span className={styles.feedbackStatus}>Thanks for the feedback</span>}
        {submit.isError && (
          <span className={styles.feedbackStatus} data-tone="error" role="alert">
            {submit.error.message}
          </span>
        )}
      </div>
      {open && (
        <fieldset className={styles.feedbackDetails}>
          <legend>What went wrong? (optional)</legend>
          <div className={styles.feedbackChips}>
            {REASONS.map(([reason, label]) => (
              <button
                key={reason}
                type="button"
                aria-pressed={reasons.includes(reason)}
                onClick={() => toggleReason(reason)}
              >
                {label}
              </button>
            ))}
          </div>
          <input
            type="text"
            aria-label="Feedback note"
            placeholder="Add a short note"
            maxLength={PORTFOLIO_ASSISTANT_FEEDBACK_NOTE_MAX_CHARS}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <div className={styles.feedbackActions}>
            <span>
              {note.length}/{PORTFOLIO_ASSISTANT_FEEDBACK_NOTE_MAX_CHARS}
            </span>
            <button type="button" onClick={() => setOpen(false)}>
              Close
            </button>
            <button type="button" disabled={submit.isPending} onClick={sendDetails}>
              Send
            </button>
          </div>
        </fieldset>
      )}
    </div>
  );
}
