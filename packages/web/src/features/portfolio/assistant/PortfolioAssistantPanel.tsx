import { useAccountSession } from '@components/auth/AccountSessionProvider';
import type { PortfolioSource } from '@oggregator/protocol';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { defineMessages, useLocale, useT } from '@lib/i18n';

import {
  PORTFOLIO_ASSISTANT_QKEY,
  usePortfolioAssistantAccess,
  usePortfolioAssistantConversation,
  usePortfolioAssistantThread,
} from './hooks';
import { PortfolioAssistantComposer } from './PortfolioAssistantComposer';
import { PortfolioAssistantInviteForm } from './PortfolioAssistantInviteForm';
import { PortfolioAssistantMemory } from './PortfolioAssistantMemory';
import styles from './PortfolioAssistantPanel.module.css';
import { PortfolioAssistantTranscript } from './PortfolioAssistantTranscript';
import { assistantErrorFrom, assistantErrorText } from './i18n';

const messages = defineMessages(
  {
    suggestion1: 'What are the main risks in this portfolio?',
    suggestion2: 'Which expiry contributes the most negative theta?',
    suggestion3: 'Why could unrealized PnL be incomplete?',
    waiting: 'waiting',
    eyebrow: 'PORTFOLIO INTELLIGENCE',
    askHermes: 'Ask Hermes',
    beta: 'BETA',
    ready: 'Ready',
    checking: 'Checking',
    locked: 'Locked',
    all: 'ALL',
    accessError: 'Portfolio Assistant access could not be verified.',
    privateBeta: 'Private beta access',
    privateBetaBody: 'Use an invite to unlock grounded explanations for the portfolio on this page.',
    hermesDown: 'Hermes is temporarily unavailable. Your saved conversation is still available.',
    historyUnavailable: 'Assistant history storage is unavailable, so chat is disabled.',
    assistantUnavailable: 'Portfolio Assistant is temporarily unavailable.',
    opening: 'Opening conversation...',
    grounded: 'Grounded in current analytics',
    memory: 'Memory',
    newChat: 'New chat',
    startWith: 'Start with the current risk surface',
    retry: 'Retry',
    responding: 'Hermes is responding.',
    footer: 'Explains Oggregator calculations; does not place trades.',
  },
  {
    suggestion1: '¿Cuáles son los principales riesgos de este portafolio?',
    suggestion2: '¿Qué vencimiento aporta la theta más negativa?',
    suggestion3: '¿Por qué el PnL no realizado podría estar incompleto?',
    waiting: 'esperando',
    eyebrow: 'INTELIGENCIA DE PORTAFOLIO',
    askHermes: 'Pregúntale a Hermes',
    beta: 'BETA',
    ready: 'Listo',
    checking: 'Verificando',
    locked: 'Bloqueado',
    all: 'TODOS',
    accessError: 'No se pudo verificar el acceso a Portfolio Assistant.',
    privateBeta: 'Acceso a beta privada',
    privateBetaBody:
      'Usa una invitación para desbloquear explicaciones fundamentadas del portafolio de esta página.',
    hermesDown:
      'Hermes no está disponible temporalmente. Tu conversación guardada sigue disponible.',
    historyUnavailable:
      'El almacenamiento del historial del asistente no está disponible, así que el chat está desactivado.',
    assistantUnavailable: 'Portfolio Assistant no está disponible temporalmente.',
    opening: 'Abriendo conversación...',
    grounded: 'Basado en la analítica actual',
    memory: 'Memoria',
    newChat: 'Nuevo chat',
    startWith: 'Empieza por la superficie de riesgo actual',
    retry: 'Reintentar',
    responding: 'Hermes está respondiendo.',
    footer: 'Explica los cálculos de Oggregator; no coloca trades.',
  },
);

const SUGGESTION_KEYS = ['suggestion1', 'suggestion2', 'suggestion3'] as const;

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
  const t = useT(messages);
  const locale = useLocale();
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
  const [showMemory, setShowMemory] = useState(false);

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
    : t('waiting');
  const reason = access.data?.reason;
  const conversationError =
    conversation.error == null
      ? null
      : assistantErrorText(conversation.errorCode, conversation.error, locale);
  const threadError =
    thread.error == null ? null : assistantErrorFrom(thread.error, 'request_failed', locale);

  return (
    <section className={styles.panel} aria-labelledby="portfolio-assistant-title">
      <header className={styles.header}>
        <div>
          <div className={styles.eyebrow}>{t('eyebrow')}</div>
          <h3 id="portfolio-assistant-title">
            {t('askHermes')} <span className={styles.betaTag}>{t('beta')}</span>
          </h3>
        </div>
        <div className={styles.availability} data-online={enabled || undefined}>
          <i />
          {enabled ? t('ready') : access.isLoading ? t('checking') : t('locked')}
        </div>
      </header>

      <div className={styles.contextStrip}>
        <span>{source}</span>
        <span>{underlying ?? t('all')}</span>
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
          {t('accessError')}
        </div>
      ) : reason === 'invite_required' ? (
        <div className={styles.lockedState}>
          <div className={styles.lockMark}>H</div>
          <h4>{t('privateBeta')}</h4>
          <p>{t('privateBetaBody')}</p>
          <PortfolioAssistantInviteForm onRedeemed={refreshAccess} />
        </div>
      ) : !enabled ? (
        providerUnavailable ? (
          <>
            <div className={styles.noticeCompact}>
              {t('hermesDown')}
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
              ? t('historyUnavailable')
              : t('assistantUnavailable')}
          </div>
        )
      ) : (
        <>
          <div className={styles.toolbar}>
            <span>
              {thread.isLoading ? t('opening') : t('grounded')}
            </span>
            <div className={styles.toolbarActions}>
              <button
                type="button"
                aria-expanded={showMemory}
                onClick={() => setShowMemory((open) => !open)}
              >
                {t('memory')}
              </button>
              <button
                type="button"
                disabled={conversation.isStreaming || !thread.threadId}
                onClick={() => void thread.startNewChat()}
              >
                {t('newChat')}
              </button>
            </div>
          </div>
          {showMemory && <PortfolioAssistantMemory />}
          <PortfolioAssistantTranscript
            messages={conversation.messages}
            isLoading={conversation.isLoading || thread.isLoading}
            feedbackThreadId={thread.threadId}
          />
          {conversation.messages.length === 0 && !conversation.isLoading && (
            <div className={styles.suggestions}>
              <p>{t('startWith')}</p>
              {SUGGESTION_KEYS.map((key) => (
                <button key={key} type="button" onClick={() => void send(t(key))}>
                  {t(key)}
                </button>
              ))}
            </div>
          )}
          {(conversation.error || thread.error) && (
            <div className={styles.inlineError} role="alert">
              {conversationError ?? threadError}
              {lastPrompt && !conversation.isStreaming && (
                <button type="button" onClick={() => void send(lastPrompt)}>
                  {t('retry')}
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
            {conversation.isStreaming ? t('responding') : (conversationError ?? '')}
          </div>
        </>
      )}

      <footer>{t('footer')}</footer>
    </section>
  );
}
