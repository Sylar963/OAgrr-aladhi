import { type FormEvent, useState } from 'react';

import { redeemPortfolioAssistantInvite } from './api';
import styles from './PortfolioAssistantPanel.module.css';

export function PortfolioAssistantInviteForm({ onRedeemed }: { onRedeemed: () => Promise<void> }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!code.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await redeemPortfolioAssistantInvite(code);
      setCode('');
      await onRedeemed();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not redeem invite.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className={styles.inviteForm} onSubmit={submit}>
      <label htmlFor="portfolio-assistant-invite">Beta invite code</label>
      <div className={styles.inviteRow}>
        <input
          id="portfolio-assistant-invite"
          value={code}
          minLength={12}
          maxLength={128}
          autoComplete="off"
          onChange={(event) => setCode(event.target.value)}
        />
        <button type="submit" disabled={submitting || code.trim().length < 12}>
          {submitting ? 'Checking&' : 'Unlock'}
        </button>
      </div>
      {error && (
        <p className={styles.inlineError} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
