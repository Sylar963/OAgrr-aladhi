import { type FormEvent, useState } from 'react';

import { defineMessages, useLocale, useT } from '@lib/i18n';

import { redeemPortfolioAssistantInvite } from './api';
import { assistantErrorFrom } from './i18n';
import styles from './PortfolioAssistantPanel.module.css';

const messages = defineMessages(
  {
    label: 'Beta invite code',
    checking: 'Checking&',
    unlock: 'Unlock',
  },
  {
    label: 'Código de invitación beta',
    checking: 'Verificando…',
    unlock: 'Desbloquear',
  },
);

export function PortfolioAssistantInviteForm({ onRedeemed }: { onRedeemed: () => Promise<void> }) {
  const t = useT(messages);
  const locale = useLocale();
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
      setError(assistantErrorFrom(caught, 'invite_failed', locale, 'invite'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className={styles.inviteForm} onSubmit={submit}>
      <label htmlFor="portfolio-assistant-invite">{t('label')}</label>
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
          {submitting ? t('checking') : t('unlock')}
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
