import type { KeyboardEvent } from 'react';

import { defineMessages, useT } from '@lib/i18n';

import styles from './PortfolioAssistantPanel.module.css';

const MAX_LENGTH = 4_000;

const messages = defineMessages(
  {
    label: 'Ask about this portfolio',
    placeholder: 'Ask about risk, PnL, Greeks, expiries...',
    charsLeft: '{n} characters left',
    hint: 'Enter to send | Shift+Enter for a new line',
    stop: 'Stop',
    send: 'Send',
  },
  {
    label: 'Pregunta sobre este portafolio',
    placeholder: 'Pregunta sobre riesgo, PnL, Greeks, vencimientos...',
    charsLeft: 'quedan {n} caracteres',
    hint: 'Enter para enviar | Shift+Enter para una nueva línea',
    stop: 'Detener',
    send: 'Enviar',
  },
);

interface PortfolioAssistantComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  isStreaming: boolean;
  disabled: boolean;
}

export function PortfolioAssistantComposer({
  value,
  onChange,
  onSend,
  onStop,
  isStreaming,
  disabled,
}: PortfolioAssistantComposerProps) {
  const t = useT(messages);
  const remaining = MAX_LENGTH - value.length;
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (!disabled && !isStreaming && value.trim()) onSend();
    }
  };
  return (
    <div className={styles.composer}>
      <label className={styles.srOnly} htmlFor="portfolio-assistant-question">
        {t('label')}
      </label>
      <textarea
        id="portfolio-assistant-question"
        value={value}
        maxLength={MAX_LENGTH}
        rows={3}
        placeholder={t('placeholder')}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className={styles.composerActions}>
        <span className={styles.composerHint}>
          {remaining <= 400
            ? t('charsLeft', { n: remaining })
            : t('hint')}
        </span>
        {isStreaming ? (
          <button type="button" className={styles.stopButton} onClick={onStop}>
            {t('stop')}
          </button>
        ) : (
          <button
            type="button"
            className={styles.sendButton}
            disabled={disabled || !value.trim()}
            onClick={onSend}
          >
            {t('send')}
          </button>
        )}
      </div>
    </div>
  );
}
