import type { PortfolioAssistantMessage } from '@oggregator/protocol';
import { useEffect, useRef } from 'react';

import { defineMessages, useT } from '@lib/i18n';

import { usePortfolioAssistantFeedback } from './hooks';
import { PortfolioAssistantMessageBubble } from './PortfolioAssistantMessageBubble';
import styles from './PortfolioAssistantPanel.module.css';

const transcriptMessages = defineMessages(
  {
    loading: 'Loading conversation&',
    aria: 'Portfolio Assistant conversation',
  },
  {
    loading: 'Cargando conversación…',
    aria: 'Conversación con Portfolio Assistant',
  },
);

export function PortfolioAssistantTranscript({
  messages,
  isLoading,
  feedbackThreadId = null,
}: {
  messages: PortfolioAssistantMessage[];
  isLoading: boolean;
  feedbackThreadId?: string | null;
}) {
  const t = useT(transcriptMessages);
  const endRef = useRef<HTMLDivElement>(null);
  const feedback = usePortfolioAssistantFeedback(feedbackThreadId);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [messages]);

  if (isLoading) return <div className={styles.transcriptEmpty}>{t('loading')}</div>;
  if (messages.length === 0) return null;
  return (
    <div className={styles.transcript} aria-label={t('aria')}>
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
