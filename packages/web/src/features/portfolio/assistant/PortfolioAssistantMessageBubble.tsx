import type { PortfolioAssistantMessage } from '@oggregator/protocol';
import { useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import styles from './PortfolioAssistantPanel.module.css';

type CopyState = 'idle' | 'copied' | 'failed';

const COPY_FEEDBACK_MS = 1_500;

function CopyMarkdownButton({ markdown }: { markdown: string }) {
  const [state, setState] = useState<CopyState>('idle');

  useEffect(() => {
    if (state === 'idle') return;
    const timer = setTimeout(() => setState('idle'), COPY_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [state]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setState('copied');
    } catch {
      setState('failed');
    }
  };

  const label =
    state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy as Markdown';

  return (
    <button
      type="button"
      className={styles.copyButton}
      data-state={state}
      onClick={() => void copy()}
      aria-label={label}
      title={label}
    >
      {state === 'copied' ? (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3.5 8.5l3 3 6-7" />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
          <path d="M10.5 3.5v-.5A1.5 1.5 0 0 0 9 1.5H4A1.5 1.5 0 0 0 2.5 3v5A1.5 1.5 0 0 0 4 9.5h.5" />
        </svg>
      )}
    </button>
  );
}

export function PortfolioAssistantMessageBubble({
  message,
}: {
  message: PortfolioAssistantMessage;
}) {
  const copyable =
    message.role === 'assistant' && message.status !== 'streaming' && message.content.length > 0;
  return (
    <article className={styles.message} data-role={message.role} data-status={message.status}>
      <div className={styles.messageHeader}>
        <span className={styles.messageRole}>{message.role === 'assistant' ? 'Hermes' : 'You'}</span>
        {copyable && <CopyMarkdownButton markdown={message.content} />}
      </div>
      <div className={styles.messageBody}>
        <Markdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ children, ...props }) => (
              <a {...props} rel="noreferrer noopener" target="_blank">
                {children}
              </a>
            ),
          }}
        >
          {message.content || (message.status === 'streaming' ? 'Thinking…' : '')}
        </Markdown>
      </div>
      {message.status === 'cancelled' && <span className={styles.messageState}>Stopped</span>}
      {message.status === 'failed' && <span className={styles.messageState}>Incomplete</span>}
    </article>
  );
}
