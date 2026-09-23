import type { PortfolioAssistantMessage } from '@oggregator/protocol';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import styles from './PortfolioAssistantPanel.module.css';

export function PortfolioAssistantMessageBubble({
  message,
}: {
  message: PortfolioAssistantMessage;
}) {
  return (
    <article className={styles.message} data-role={message.role} data-status={message.status}>
      <span className={styles.messageRole}>{message.role === 'assistant' ? 'Hermes' : 'You'}</span>
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
          {message.content || (message.status === 'streaming' ? 'Thinking&' : '')}
        </Markdown>
      </div>
      {message.status === 'cancelled' && <span className={styles.messageState}>Stopped</span>}
      {message.status === 'failed' && <span className={styles.messageState}>Incomplete</span>}
    </article>
  );
}
