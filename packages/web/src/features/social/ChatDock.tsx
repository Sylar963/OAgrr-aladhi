import { defineMessages, useT } from "@lib/i18n";
import type { ChatMessageDto } from "@oggregator/protocol";
import { useEffect, useState } from "react";

import styles from "./ChatDock.module.css";
import ChatPanel from "./ChatPanel";
import type { useSocialSocket } from "./hooks/useSocialSocket";
import { socialMessages } from "./i18n";

const messages = defineMessages(
  {
    openChat: "Open global chat",
    openChatUnread: "Open global chat, {n} new",
  },
  {
    openChat: "Abrir chat global",
    openChatUnread: "Abrir chat global, {n} nuevos",
  },
);

type SocialSocket = ReturnType<typeof useSocialSocket>;

/** Messages from others posted after `seenAt`; chat history from before the page opened never counts. */
export function unreadCount(
  messages: ChatMessageDto[],
  seenAt: number,
): number {
  return messages.filter(
    (message) => !message.mine && Date.parse(message.createdAt) > seenAt,
  ).length;
}

interface ChatDockProps {
  state: SocialSocket["state"];
  send: SocialSocket["send"];
  reconnect: SocialSocket["reconnect"];
}

export default function ChatDock({ state, send, reconnect }: ChatDockProps) {
  const t = useT(messages);
  const ts = useT(socialMessages);
  const [open, setOpen] = useState(false);
  const [seenAt, setSeenAt] = useState(() => Date.now());
  const unread = open ? 0 : unreadCount(state.messages, seenAt);
  const live = state.connection === "live";

  useEffect(() => {
    if (!open) return;
    const latest = state.messages.at(-1);
    setSeenAt(Math.max(Date.now(), latest ? Date.parse(latest.createdAt) : 0));
  }, [open, state.messages]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className={styles.dock} data-open={open}>
      <div className={styles.panel} hidden={!open}>
        <ChatPanel
          state={state}
          send={send}
          reconnect={reconnect}
          open={open}
          onMinimize={() => setOpen(false)}
        />
      </div>
      {!open && (
        <button
          className={styles.tab}
          onClick={() => setOpen(true)}
          aria-expanded={false}
          aria-label={
            unread > 0 ? t("openChatUnread", { n: unread }) : t("openChat")
          }
        >
          <span className={styles.dot} data-state={state.connection} />
          <span className={styles.tabTitle}>{ts("globalChat")}</span>
          <span className={styles.tabMeta}>
            {live
              ? ts("online", { n: state.online })
              : state.connection === "error"
                ? ts("offline")
                : ts("connecting")}
          </span>
          {unread > 0 && (
            <span className={styles.badge}>{unread > 99 ? "99+" : unread}</span>
          )}
          <span className={styles.chevron} aria-hidden>
            ▴
          </span>
        </button>
      )}
    </div>
  );
}
