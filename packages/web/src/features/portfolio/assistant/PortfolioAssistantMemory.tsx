import type { PortfolioAssistantMemoryCategory } from '@oggregator/protocol';
import { useState } from 'react';

import { defineMessages, useLocale, useT } from '@lib/i18n';

import { useForgetPortfolioAssistantMemory, usePortfolioAssistantMemory } from './hooks';
import { assistantErrorFrom } from './i18n';
import styles from './PortfolioAssistantPanel.module.css';

const messages = defineMessages(
  {
    risk_budget: 'Risk',
    preferred_structures: 'Structures',
    experience_level: 'Experience',
    explanation_style: 'Style',
    venues: 'Venues',
    goals: 'Goals',
    explicit_note: 'Note',
    title: 'What Hermes remembers',
    confirmForgetAll: 'Confirm forget all',
    cancel: 'Cancel',
    forgetAll: 'Forget all',
    note: 'Preferences learned once a day from your chats. Used only in your own conversations.',
    loading: 'Loading…',
    loadError: 'Memory could not be loaded.',
    empty: 'Nothing remembered yet.',
    forgetItem: 'Forget: {text}',
  } satisfies Record<PortfolioAssistantMemoryCategory, string> & Record<string, string>,
  {
    risk_budget: 'Riesgo',
    preferred_structures: 'Estructuras',
    experience_level: 'Experiencia',
    explanation_style: 'Estilo',
    venues: 'Exchanges',
    goals: 'Objetivos',
    explicit_note: 'Nota',
    title: 'Lo que Hermes recuerda',
    confirmForgetAll: 'Confirmar olvidar todo',
    cancel: 'Cancelar',
    forgetAll: 'Olvidar todo',
    note: 'Preferencias aprendidas una vez al día a partir de tus chats. Solo se usan en tus propias conversaciones.',
    loading: 'Cargando…',
    loadError: 'No se pudo cargar la memoria.',
    empty: 'Aún no hay nada recordado.',
    forgetItem: 'Olvidar: {text}',
  },
);

export function PortfolioAssistantMemory() {
  const t = useT(messages);
  const locale = useLocale();
  const memory = usePortfolioAssistantMemory();
  const forget = useForgetPortfolioAssistantMemory();
  const [confirmingAll, setConfirmingAll] = useState(false);
  const items = memory.data?.items ?? [];

  return (
    <section className={styles.memory} aria-labelledby="portfolio-assistant-memory-title">
      <div className={styles.memoryHeader}>
        <h4 id="portfolio-assistant-memory-title">{t('title')}</h4>
        {items.length > 0 &&
          (confirmingAll ? (
            <span className={styles.memoryConfirm}>
              <button
                type="button"
                disabled={forget.isPending}
                onClick={() => forget.mutate(null, { onSettled: () => setConfirmingAll(false) })}
              >
                {t('confirmForgetAll')}
              </button>
              <button type="button" onClick={() => setConfirmingAll(false)}>
                {t('cancel')}
              </button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirmingAll(true)}>
              {t('forgetAll')}
            </button>
          ))}
      </div>
      <p className={styles.memoryNote}>
        {t('note')}
      </p>
      {memory.isLoading ? (
        <p className={styles.memoryEmpty}>{t('loading')}</p>
      ) : memory.isError ? (
        <p className={styles.memoryEmpty} role="alert">
          {t('loadError')}
        </p>
      ) : items.length === 0 ? (
        <p className={styles.memoryEmpty}>{t('empty')}</p>
      ) : (
        <ul className={styles.memoryList}>
          {items.map((item) => (
            <li key={item.id}>
              <span className={styles.memoryCategory}>{t(item.category)}</span>
              <span className={styles.memoryText}>{item.text}</span>
              <button
                type="button"
                aria-label={t('forgetItem', { text: item.text })}
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
          {assistantErrorFrom(forget.error, 'delete_failed', locale)}
        </p>
      )}
    </section>
  );
}
