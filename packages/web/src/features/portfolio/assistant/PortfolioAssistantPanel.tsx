import { useAccountSession } from '@components/auth/AccountSessionProvider';
import type { PortfolioSource } from '@oggregator/protocol';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  PORTFOLIO_ASSISTANT_QKEY,
  usePortfolioAssistantAccess,
  usePortfolioAssistantConversation,
  usePortfolioAssistantThread,
} from './hooks';
import { PortfolioAssistantComposer } from './PortfolioAssistantComposer';
import { PortfolioAssistantInviteForm } from './PortfolioAssistantInviteForm';
import styles from './PortfolioAssistantPanel.module.css';
import { PortfolioAssistantTranscript } from './PortfolioAssistantTranscript';

const SUGGESTIONS = [
  'What are the main risks in this portfolio?',
  'Which expiry contributes the most negative theta?',
  'Why could unrealized PnL be incomplete?',
];

interface PortfolioAssistantPanelProps {
  source: PortfolioSource;
  underlying: string | null;
  forwardDays: number;
  generatedAt: number | null;
}

export function PortfolioAssistantPanel({
  source,
  underlying,
  forwardDays,
  generatedAt,
}: PortfolioAssistantPanelProps) {
  const session = useAccountSession();
  const queryClient = useQueryClient();
  const access = usePortfolioAssistantAccess();
  const enabled = access.data?.enabled === true;
  const providerUnavailable = access.data?.reason === 'provider_unavailable';
  const canLoadConversation = enabled || providerUnavailable;
  const thread = usePortfolioAssistantThread(source, underlying, canLoadConversation);
  const conversation = usePortfolioAssistantConversation(thread.threadId);
  const [draft, setDraft] = useState('');
  const [lastPrompt, setLastPrompt] = useState<string | null>(null);

  const send = async (prompt = draft) => {
    const message = prompt.trim();
    if (!message) return;
    setLastPrompt(message);
    setDraft('');
    await conversation.sendMessage(message, forwardDays);
  };

  const refreshAccess = async () => {
    if (session.accountId) {
      await queryClient.invalidateQueries({
        queryKey: PORTFOLIO_ASSISTANT_QKEY.access(session.accountId),
      });
    }
  };

  const snapshotLabel = generatedAt
    ? new Date(generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : 'waiting';
  const reason = access.data?.reason;

  return (
    <section className={styles.panel} aria-labelledby="portfolio-assistant-title">
      <header className={styles.header}>
        <div>
          <div className={styles.eyebrow}>PORTFOLIO INTELLIGENCE</div>
          <h3 id="portfolio-assistant-title">
            Ask Hermes <span className={styles.betaTag}>BETA</span>
          </h3>
        </div>
        <div className={styles.availability} data-online={enabled || undefined}>
          <i />
          {enabled ? 'Ready' : access.isLoading ? 'Checking' : 'Locked'}
        </div>
      </header>

      <div className={styles.contextStrip}>
        <span>{source}</span>
        <span>{underlying ?? 'ALL'}</span>
        <span>T+{forwardDays}d</span>
        <span>{snapshotLabel}</span>
      </div>

      {access.isLoading ? (
        <div className={styles.loadingState}>
          <i />
          <i />
          <i />
        </div>
      ) : access.isError ? (
        <div className={styles.notice} data-tone="error">
          Portfolio Assistant access could not be verified.
        </div>
      ) : reason === 'invite_required' ? (
        <div className={styles.lockedState}>
          <div className={styles.lockMark}>H</div>
          <h4>Private beta access</h4>
          <p>Use an invite to unlock grounded explanations for the portfolio on this page.</p>
          <PortfolioAssistantInviteForm onRedeemed={refreshAccess} />
        </div>
      ) : !enabled ? (
        providerUnavailable ? (
          <>
            <div className={styles.noticeCompact}>
              Hermes is temporarily unavailable. Your saved conversation is still available.
            </div>
            <PortfolioAssistantTranscript
              messages={conversation.messages}
              isLoading={conversation.isLoading || thread.isLoading}
            />
            <PortfolioAssistantComposer
              value={draft}
              onChange={setDraft}
              onSend={() => undefined}
              onStop={conversation.stop}
              isStreaming={false}
              disabled
            />
          </>
        ) : (
          <div className={styles.notice} data-tone="neutral">
            {reason === 'persistence_unavailable'
              ? 'Assistant history storage is unavailable, so chat is disabled.'
              : 'Portfolio Assistant is temporarily unavailable.'}
          </div>
        )
      ) : (
        <>
          <div className={styles.toolbar}>
            <span>
              {thread.isLoading ? 'Opening conversation...' : 'Grounded in current analytics'}
            </span>
            <button
              type="button"
              disabled={conversation.isStreaming || !thread.threadId}
              onClick={() => void thread.startNewChat()}
            >
              New chat
            </button>
          </div>
          <PortfolioAssistantTranscript
            messages={conversation.messages}
            isLoading={conversation.isLoading || thread.isLoading}
          />
          {conversation.messages.length === 0 && !conversation.isLoading && (
            <div className={styles.suggestions}>
              <p>Start with the current risk surface</p>
              {SUGGESTIONS.map((question) => (
                <button key={question} type="button" onClick={() => void send(question)}>
                  {question}
                </button>
              ))}
            </div>
          )}
          {(conversation.error || thread.error) && (
            <div className={styles.inlineError} role="alert">
              {conversation.error ?? thread.error?.message}
              {lastPrompt && !conversation.isStreaming && (
                <button type="button" onClick={() => void send(lastPrompt)}>
                  Retry
                </button>
              )}
            </div>
          )}
          <PortfolioAssistantComposer
            value={draft}
            onChange={setDraft}
            onSend={() => void send()}
            onStop={conversation.stop}
            isStreaming={conversation.isStreaming}
            disabled={!thread.threadId || thread.isLoading}
          />
          <div className={styles.liveRegion} aria-live="polite">
            {conversation.isStreaming ? 'Hermes is responding.' : (conversation.error ?? '')}
          </div>
        </>
      )}

      <footer>Explains Oggregator calculations; does not place trades.</footer>
    </section>
  );
}
