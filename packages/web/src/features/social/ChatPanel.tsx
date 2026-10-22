import { defineMessages, useT } from '@lib/i18n';
import { CHAT_MESSAGE_MAX_CHARS } from '@oggregator/protocol';
import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import styles from './ChatPanel.module.css';
import { useSocialProfile } from './hooks/queries';
import type { useSocialSocket } from './hooks/useSocialSocket';
import { socialMessages } from './i18n';

const messages = defineMessages(
  {
    retry: 'Retry',
    minimizeChat: 'Minimize chat',
    minimizeTitle: 'Minimize (Esc)',
    empty: 'No messages yet. Say gm.',
    deleteMessage: 'Delete message',
    delete: 'Delete',
    mutedUntil: 'You are muted until {time}.',
    placeholder: 'Message global chat…',
    placeholderConnecting: 'Connecting…',
    postAs: 'Post as',
    send: 'Send',
    needUsername: 'Add a username to your account to post under your name.',
  },
  {
    retry: 'Reintentar',
    minimizeChat: 'Minimizar chat',
    minimizeTitle: 'Minimizar (Esc)',
    empty: 'Aún no hay mensajes. Di gm.',
    deleteMessage: 'Eliminar mensaje',
    delete: 'Eliminar',
    mutedUntil: 'Estás silenciado hasta las {time}.',
    placeholder: 'Escribe en el chat global…',
    placeholderConnecting: 'Conectando…',
    postAs: 'Publicar como',
    send: 'Enviar',
    needUsername: 'Agrega un nombre de usuario a tu cuenta para publicar con tu nombre.',
  },
);

const ERROR_VISIBLE_MS = 4_000;
const STICK_TO_BOTTOM_PX = 80;

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

type SocialSocket = ReturnType<typeof useSocialSocket>;

interface ChatPanelProps {
  state: SocialSocket['state'];
  send: SocialSocket['send'];
  reconnect: SocialSocket['reconnect'];
  /** The panel stays mounted while docked closed so a draft survives; reopening re-pins the list. */
  open?: boolean;
  onMinimize?: () => void;
}

export default function ChatPanel({ state, send, reconnect, open = true, onMinimize }: ChatPanelProps) {
  const t = useT(messages);
  const ts = useT(socialMessages);
  const profile = useSocialProfile();
  const handle = profile.data?.handle ?? null;
  const [draft, setDraft] = useState('');
  const [anon, setAnon] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const stickRef = useRef(true);

  useEffect(() => {
    if (!state.lastError) return;
    const timer = setTimeout(() => setNow(Date.now()), ERROR_VISIBLE_MS);
    setNow(Date.now());
    return () => clearTimeout(timer);
  }, [state.lastError]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (list && stickRef.current) list.scrollTop = list.scrollHeight;
  }, [state.messages, open]);

  const docked = onMinimize != null;
  useEffect(() => {
    if (open && docked) inputRef.current?.focus();
  }, [open, docked]);

  const postingAnon = anon || !handle;
  const muted = state.mutedUntil != null && Date.parse(state.mutedUntil) > now;
  const live = state.connection === 'live';
  const error =
    state.lastError && now - state.lastError.at < ERROR_VISIBLE_MS ? state.lastError.message : null;

  function submit(event?: FormEvent) {
    event?.preventDefault();
    const body = draft.trim();
    if (!body || !live) return;
    if (send({ type: 'send', body, anon: postingAnon })) setDraft('');
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <section className={styles.chat}>
      <header className={styles.header}>
        <h2 className={styles.title}>{ts('globalChat')}</h2>
        <span className={styles.status} data-state={state.connection}>
          <span className={styles.dot} />
          {live
            ? ts('online', { n: state.online })
            : state.connection === 'error'
              ? ts('offline')
              : ts('connecting')}
        </span>
        {state.connection === 'error' && (
          <button className={styles.retry} onClick={reconnect}>
            {t('retry')}
          </button>
        )}
        {onMinimize && (
          <button
            className={styles.minimize}
            onClick={onMinimize}
            aria-label={t('minimizeChat')}
            title={t('minimizeTitle')}
          >
            ▾
          </button>
        )}
      </header>

      <div
        ref={listRef}
        className={styles.list}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_TO_BOTTOM_PX;
        }}
      >
        {state.messages.length === 0 ? (
          <p className={styles.empty}>{live ? t('empty') : ' '}</p>
        ) : (
          state.messages.map((message) => (
            <article key={message.id} className={styles.message} data-mine={message.mine}>
              <div className={styles.meta}>
                <span className={styles.alias} data-anon={message.isAnon}>
                  {message.isAnon ? message.alias : `@${message.alias}`}
                </span>
                <time className={styles.time} dateTime={message.createdAt}>
                  {fmtTime(message.createdAt)}
                </time>
                {message.mine && (
                  <button
                    className={styles.delete}
                    onClick={() => send({ type: 'delete', id: message.id })}
                    aria-label={t('deleteMessage')}
                    title={t('delete')}
                  >
                    ×
                  </button>
                )}
              </div>
              <p className={styles.body}>{message.body}</p>
            </article>
          ))
        )}
      </div>

      <form className={styles.composer} onSubmit={submit}>
        {error && <p className={styles.error}>{error}</p>}
        {muted ? (
          <p className={styles.notice}>{t('mutedUntil', { time: fmtTime(state.mutedUntil!) })}</p>
        ) : (
          <>
            <textarea
              ref={inputRef}
              className={styles.input}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={live ? t('placeholder') : t('placeholderConnecting')}
              maxLength={CHAT_MESSAGE_MAX_CHARS}
              rows={2}
              disabled={!live}
            />
            <div className={styles.controls}>
              <label className={styles.anonToggle}>
                <input
                  type="checkbox"
                  checked={postingAnon}
                  disabled={!handle}
                  onChange={(e) => setAnon(e.target.checked)}
                />
                <span>
                  {t('postAs')}{' '}
                  <strong>{postingAnon ? (state.anonAlias ?? 'anon') : `@${handle}`}</strong>
                </span>
              </label>
              <span className={styles.count}>
                {draft.length}/{CHAT_MESSAGE_MAX_CHARS}
              </span>
              <button className={styles.send} type="submit" disabled={!live || !draft.trim()}>
                {t('send')}
              </button>
            </div>
            {!handle && (
              <p className={styles.notice}>{t('needUsername')}</p>
            )}
          </>
        )}
      </form>
    </section>
  );
}
