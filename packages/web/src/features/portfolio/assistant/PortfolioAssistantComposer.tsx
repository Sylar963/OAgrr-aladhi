import type { KeyboardEvent } from 'react';

import styles from './PortfolioAssistantPanel.module.css';

const MAX_LENGTH = 4_000;

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
        Ask about this portfolio
      </label>
      <textarea
        id="portfolio-assistant-question"
        value={value}
        maxLength={MAX_LENGTH}
        rows={3}
        placeholder="Ask about risk, PnL, Greeks, expiries..."
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className={styles.composerActions}>
        <span className={styles.composerHint}>
          {remaining <= 400
            ? `${remaining} characters left`
            : 'Enter to send | Shift+Enter for a new line'}
        </span>
        {isStreaming ? (
          <button type="button" className={styles.stopButton} onClick={onStop}>
            Stop
          </button>
        ) : (
          <button
            type="button"
            className={styles.sendButton}
            disabled={disabled || !value.trim()}
            onClick={onSend}
          >
            Send
          </button>
        )}
      </div>
    </div>
  );
}
