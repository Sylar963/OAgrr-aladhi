import type { PortfolioAssistantMemoryCategory } from '@oggregator/protocol';
import { useState } from 'react';

import { useForgetPortfolioAssistantMemory, usePortfolioAssistantMemory } from './hooks';
import styles from './PortfolioAssistantPanel.module.css';

const CATEGORY_LABELS: Record<PortfolioAssistantMemoryCategory, string> = {
  risk_budget: 'Risk',
  preferred_structures: 'Structures',
  experience_level: 'Experience',
  explanation_style: 'Style',
  venues: 'Venues',
  goals: 'Goals',
  explicit_note: 'Note',
};

export function PortfolioAssistantMemory() {
  const memory = usePortfolioAssistantMemory();
  const forget = useForgetPortfolioAssistantMemory();
  const [confirmingAll, setConfirmingAll] = useState(false);
  const items = memory.data?.items ?? [];

  return (
    <section className={styles.memory} aria-labelledby="portfolio-assistant-memory-title">
      <div className={styles.memoryHeader}>
        <h4 id="portfolio-assistant-memory-title">What Hermes remembers</h4>
        {items.length > 0 &&
          (confirmingAll ? (
            <span className={styles.memoryConfirm}>
              <button
                type="button"
                disabled={forget.isPending}
                onClick={() => forget.mutate(null, { onSettled: () => setConfirmingAll(false) })}
              >
                Confirm forget all
              </button>
              <button type="button" onClick={() => setConfirmingAll(false)}>
                Cancel
              </button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirmingAll(true)}>
              Forget all
            </button>
          ))}
      </div>
      <p className={styles.memoryNote}>
        Preferences learned once a day from your chats. Used only in your own conversations.
      </p>
      {memory.isLoading ? (
        <p className={styles.memoryEmpty}>Loading…</p>
      ) : memory.isError ? (
        <p className={styles.memoryEmpty} role="alert">
          Memory could not be loaded.
        </p>
      ) : items.length === 0 ? (
        <p className={styles.memoryEmpty}>Nothing remembered yet.</p>
      ) : (
        <ul className={styles.memoryList}>
          {items.map((item) => (
            <li key={item.id}>
              <span className={styles.memoryCategory}>{CATEGORY_LABELS[item.category]}</span>
              <span className={styles.memoryText}>{item.text}</span>
              <button
                type="button"
                aria-label={`Forget: ${item.text}`}
                disabled={forget.isPending}
                onClick={() => forget.mutate(item.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {forget.isError && (
        <p className={styles.memoryEmpty} role="alert">
          {forget.error.message}
        </p>
      )}
    </section>
  );
}
