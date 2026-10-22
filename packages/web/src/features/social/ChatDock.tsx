import type { ChatMessageDto } from '@oggregator/protocol';
import { useEffect, useState } from 'react';

import styles from './ChatDock.module.css';
import ChatPanel from './ChatPanel';
import type { useSocialSocket } from './hooks/useSocialSocket';

type SocialSocket = ReturnType<typeof useSocialSocket>;

/** Messages from others posted after `seenAt`; chat history from before the page opened never counts. */
export function unreadCount(messages: ChatMessageDto[], seenAt: number): number {
  return messages.filter((message) => !message.mine && Date.parse(message.createdAt) > seenAt).length;
}

interface ChatDockProps {
  state: SocialSocket['state'];
  send: SocialSocket['send'];
  reconnect: SocialSocket['reconnect'];
}

export default function ChatDock({ state, send, reconnect }: ChatDockProps) {
  const [open, setOpen] = useState(false);
  const [seenAt, setSeenAt] = useState(() => Date.now());
  const unread = open ? 0 : unreadCount(state.messages, seenAt);
  const live = state.connection === 'live';

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  function close() {
    const latest = state.messages.at(-1);
    setSeenAt(Math.max(Date.now(), latest ? Date.parse(latest.createdAt) : 0));
    setOpen(false);
  }

  return (
    <div className={styles.dock} data-open={open}>
      <div className={styles.panel} hidden={!open}>
        <ChatPanel state={state} send={send} reconnect={reconnect} open={open} onMinimize={close} />
      </div>
      {!open && (
        <button
          className={styles.tab}
          onClick={() => setOpen(true)}
          aria-expanded={false}
          aria-label={unread > 0 ? `Open global chat, ${unread} new` : 'Open global chat'}
        >
          <span className={styles.dot} data-state={state.connection} />
          <span className={styles.tabTitle}>Global chat</span>
          <span className={styles.tabMeta}>
            {live ? `${state.online} online` : state.connection === 'error' ? 'offline' : 'connecting…'}
          </span>
          {unread > 0 && <span className={styles.badge}>{unread > 99 ? '99+' : unread}</span>}
          <span className={styles.chevron} aria-hidden>
            ▴
          </span>
        </button>
      )}
    </div>
  );
}
