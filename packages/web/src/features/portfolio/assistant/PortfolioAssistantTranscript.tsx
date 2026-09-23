import type { PortfolioAssistantMessage } from '@oggregator/protocol';
import { useEffect, useRef } from 'react';

import { PortfolioAssistantMessageBubble } from './PortfolioAssistantMessageBubble';
import styles from './PortfolioAssistantPanel.module.css';

export function PortfolioAssistantTranscript({
  messages,
  isLoading,
}: {
  messages: PortfolioAssistantMessage[];
  isLoading: boolean;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [messages]);

  if (isLoading) return <div className={styles.transcriptEmpty}>Loading conversation&</div>;
  if (messages.length === 0) return null;
  return (
    <div className={styles.transcript} aria-label="Portfolio Assistant conversation">
      {messages.map((message) => (
        <PortfolioAssistantMessageBubble key={message.messageId} message={message} />
      ))}
      <div ref={endRef} />
    </div>
  );
}
