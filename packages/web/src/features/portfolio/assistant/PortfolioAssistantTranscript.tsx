import type { PortfolioAssistantMessage } from '@oggregator/protocol';
import { useEffect, useRef } from 'react';

import { usePortfolioAssistantFeedback } from './hooks';
import { PortfolioAssistantMessageBubble } from './PortfolioAssistantMessageBubble';
import styles from './PortfolioAssistantPanel.module.css';

export function PortfolioAssistantTranscript({
  messages,
  isLoading,
  feedbackThreadId = null,
}: {
  messages: PortfolioAssistantMessage[];
  isLoading: boolean;
  feedbackThreadId?: string | null;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const feedback = usePortfolioAssistantFeedback(feedbackThreadId);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [messages]);

  if (isLoading) return <div className={styles.transcriptEmpty}>Loading conversation&</div>;
  if (messages.length === 0) return null;
  return (
    <div className={styles.transcript} aria-label="Portfolio Assistant conversation">
      {messages.map((message) => (
        <PortfolioAssistantMessageBubble
          key={message.messageId}
          message={message}
          feedbackThreadId={feedbackThreadId}
          feedback={feedback.get(message.messageId)}
        />
      ))}
      <div ref={endRef} />
    </div>
  );
}
