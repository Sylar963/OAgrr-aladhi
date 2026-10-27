import { useAccountSession } from '@components/auth/AccountSessionProvider';
import type { PortfolioMetrics, PositionLeg, PortfolioSource } from '@oggregator/protocol';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { defineMessages, useLocale, useT } from '@lib/i18n';

import {
  PORTFOLIO_ASSISTANT_QKEY,
  usePortfolioAssistantAccess,
  usePortfolioAssistantConversation,
  usePortfolioAssistantThread,
} from './hooks';
import { PortfolioAssistantBriefing } from './PortfolioAssistantBriefing';
import type { AssistantActionHandler } from './PortfolioAssistantEvidence';
import { PortfolioAssistantComposer } from './PortfolioAssistantComposer';
import { PortfolioAssistantInviteForm } from './PortfolioAssistantInviteForm';
import { PortfolioAssistantMemory } from './PortfolioAssistantMemory';
import styles from './PortfolioAssistantPanel.module.css';
import { PortfolioAssistantTranscript } from './PortfolioAssistantTranscript';
import { assistantErrorFrom, assistantErrorText } from './i18n';

const messages = defineMessages(
  {
    waiting: 'waiting',
    eyebrow: 'PORTFOLIO INTELLIGENCE',
    askHermes: 'Ask Hermes',
    beta: 'BETA',
    ready: 'Available',
    expand: 'Expand chat',
    collapse: 'Collapse chat',
    snapshotFresh: 'Snapshot updated',
    snapshotStale: 'Snapshot over 30s old',
    review: 'What changed since my last review?',
    alternativesPrompt:
      'Compare alternatives for my current portfolio. Evaluate costs and book-wide risk. Ask me for any missing risk budget or market view.',
    loading_portfolio: 'Loading portfolio…',
    checking_quotes: 'Checking quotes…',
    loading_history: 'Loading account history…',
    evaluating_structures: 'Evaluating structures…',
    searching_books: 'Searching options books…',
    writing_answer: 'Preparing answer…',
    checking: 'Checking',
    locked: 'Locked',
    all: 'ALL',
    accessError: 'Portfolio Assistant access could not be verified.',
    privateBeta: 'Private beta access',
    privateBetaBody:
      'Use an invite to unlock grounded explanations for the portfolio on this page.',
    hermesDown: 'Hermes is temporarily unavailable. Your saved conversation is still available.',
    historyUnavailable: 'Assistant history storage is unavailable, so chat is disabled.',
    assistantUnavailable: 'Portfolio Assistant is temporarily unavailable.',
    opening: 'Opening conversation...',
    memory: 'Memory',
    newChat: 'New chat',
    retry: 'Retry',
    responding: 'Hermes is responding.',
    footer: 'Explains Oggregator calculations; does not place trades.',
  },
  {
    waiting: 'esperando',
    eyebrow: 'INTELIGENCIA DE PORTAFOLIO',
    askHermes: 'Pregúntale a Hermes',
    beta: 'BETA',
    ready: 'Disponible',
    expand: 'Ampliar chat',
    collapse: 'Reducir chat',
    snapshotFresh: 'Snapshot actualizado',
    snapshotStale: 'Snapshot de hace más de 30 s',
    review: '¿Qué cambió desde mi última revisión?',
    alternativesPrompt:
      'Compara alternativas para mi portafolio actual. Evalúa costos y riesgo de todo el libro. Pregúntame por el presupuesto de riesgo o la visión de mercado si faltan.',
    loading_portfolio: 'Cargando portafolio…',
    checking_quotes: 'Verificando cotizaciones…',
    loading_history: 'Cargando historial de cuenta…',
    evaluating_structures: 'Evaluando estructuras…',
    searching_books: 'Buscando en libros de opciones…',
    writing_answer: 'Preparando respuesta…',
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
    memory: 'Memoria',
    newChat: 'Nuevo chat',
    retry: 'Reintentar',
    responding: 'Hermes está respondiendo.',
    footer: 'Explica los cálculos de Oggregator; no coloca trades.',
  },
);

interface PortfolioAssistantPanelProps {
  source: PortfolioSource;
  underlying: string | null;
  forwardDays: number;
  generatedAt: number | null;
  metrics?: PortfolioMetrics | null;
  positions?: PositionLeg[];
  onNavigate?: (action: 'positions' | 'scenario', legIds: string[]) => void;
}

export function PortfolioAssistantPanel({
  source,
  underlying,
  forwardDays,
  generatedAt,
  metrics = null,
  positions = [],
  onNavigate,
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
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(Date.now);
  const panelRef = useRef<HTMLElement>(null);
  const expandRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef(true);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!expanded) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setExpanded(false);
      }
      if (event.key !== 'Tab') return;
      const focusable = [
        ...(panelRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex="0"]',
        ) ?? []),
      ];
      const first = focusable[0];
      const last = focusable.at(-1);
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === panelRef.current)) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && (active === last || active === panelRef.current)) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKey);
      if (restoreFocusRef.current) requestAnimationFrame(() => expandRef.current?.focus());
      restoreFocusRef.current = true;
    };
  }, [expanded]);

  const onAction: AssistantActionHandler = (action, evidence) => {
    if (evidence.snapshot.source !== source || evidence.snapshot.underlying !== underlying) return;
    if (action === 'alternatives') {
      setDraft(t('alternativesPrompt'));
      panelRef.current?.querySelector('textarea')?.focus();
    } else {
      if (expanded) restoreFocusRef.current = false;
      setExpanded(false);
      requestAnimationFrame(() => onNavigate?.(action, evidence.relevantLegIds));
    }
  };

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

  const panel = (
    <section
      ref={panelRef}
      className={styles.panel}
      data-expanded={expanded || undefined}
      role={expanded ? 'dialog' : undefined}
      aria-modal={expanded || undefined}
      tabIndex={expanded ? -1 : undefined}
      aria-labelledby="portfolio-assistant-title"
    >
      <header className={styles.header}>
        <div>
          <div className={styles.eyebrow}>{t('eyebrow')}</div>
          <h3 id="portfolio-assistant-title">
            {t('askHermes')} <span className={styles.betaTag}>{t('beta')}</span>
          </h3>
        </div>
        <div className={styles.headerActions}>
          <button
            ref={expandRef}
            type="button"
            className={styles.expandButton}
            aria-label={expanded ? t('collapse') : t('expand')}
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? '↙' : '↗'}
          </button>
          <div className={styles.availability} data-online={enabled || undefined}>
            <i />
            {enabled ? t('ready') : access.isLoading ? t('checking') : t('locked')}
          </div>
        </div>
      </header>

      <div className={styles.contextStrip}>
        <span>{source}</span>
        <span>{underlying ?? t('all')}</span>
        <span>T+{forwardDays}d</span>
        <span
          title={
            generatedAt == null
              ? t('waiting')
              : new Date(generatedAt).toLocaleString(locale, { timeZoneName: 'short' })
          }
        >
          {snapshotLabel}
        </span>
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
            <div className={styles.noticeCompact}>{t('hermesDown')}</div>
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
              {thread.isLoading
                ? t('opening')
                : generatedAt == null
                  ? t('waiting')
                  : now - generatedAt > 30_000
                    ? t('snapshotStale')
                    : t('snapshotFresh')}
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
            onAction={onAction}
            actionsDisabled={conversation.isStreaming}
          />
          {conversation.messages.length === 0 && !conversation.isLoading && (
            <PortfolioAssistantBriefing
              metrics={metrics}
              positions={positions}
              forwardDays={forwardDays}
              disabled={!thread.threadId || thread.isLoading || conversation.isStreaming}
              onSend={(prompt) => void send(prompt)}
            />
          )}
          {conversation.messages.some(
            (message) =>
              message.role === 'assistant' && message.status === 'complete' && message.evidence,
          ) && (
            <button
              type="button"
              className={styles.reviewButton}
              disabled={conversation.isStreaming}
              onClick={() => void send(t('review'))}
            >
              {t('review')}
            </button>
          )}
          {conversation.isStreaming && (
            <div className={styles.progress} role="status">
              <i />
              {conversation.progress ? t(conversation.progress) : t('responding')}
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
            {conversationError ?? ''}
          </div>
        </>
      )}

      <footer>{t('footer')}</footer>
    </section>
  );
  return expanded
    ? createPortal(
        <>
          <div className={styles.backdrop} onClick={() => setExpanded(false)} aria-hidden="true" />
          {panel}
        </>,
        document.body,
      )
    : panel;
}
