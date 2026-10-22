import { defineMessages, useT } from '@lib/i18n';
import { type TabId, useTabs } from '@lib/tabs';
import { useEffect } from 'react';

import styles from './ShortcutHelp.module.css';

interface ShortcutHelpProps {
  onClose: () => void;
}

const messages = defineMessages(
  {
    assetPicker: 'Asset picker',
    showShortcuts: 'Show shortcuts',
    closeOverlay: 'Close overlay',
    title: 'Keyboard shortcuts',
    escHint: 'Esc to close',
    navigation: 'Navigation',
    actions: 'Actions',
  },
  {
    assetPicker: 'Selector de activo',
    showShortcuts: 'Mostrar atajos',
    closeOverlay: 'Cerrar ventana',
    title: 'Atajos de teclado',
    escHint: 'Esc para cerrar',
    navigation: 'Navegación',
    actions: 'Acciones',
  },
);

type ActionKey = 'assetPicker' | 'showShortcuts' | 'closeOverlay';

interface Row {
  label: string;
  keys: string[];
}

const NAVIGATION: Array<{ tab: TabId; keys: string[] }> = [
  { tab: 'chain', keys: ['g', 'c'] },
  { tab: 'alpha', keys: ['g', 'a'] },
  { tab: 'architect', keys: ['g', 'b'] },
  { tab: 'trading', keys: ['g', 'p'] },
  { tab: 'surface', keys: ['g', 'v'] },
  { tab: 'flow', keys: ['g', 'f'] },
  { tab: 'analytics', keys: ['g', 'y'] },
  { tab: 'gex', keys: ['g', 'x'] },
  { tab: 'news', keys: ['g', 'n'] },
];

const ACTIONS: Array<{ labelKey: ActionKey; keys: string[] }> = [
  { labelKey: 'assetPicker', keys: ['⌘', 'K'] },
  { labelKey: 'assetPicker', keys: ['/'] },
  { labelKey: 'showShortcuts', keys: ['?'] },
  { labelKey: 'closeOverlay', keys: ['Esc'] },
];

export default function ShortcutHelp({ onClose }: ShortcutHelpProps) {
  const t = useT(messages);
  const tabs = useTabs();
  const navigationRows: Row[] = NAVIGATION.map((row) => ({
    label: tabs.find((tab) => tab.id === row.tab)?.label ?? row.tab,
    keys: row.keys,
  }));
  const actionRows: Row[] = ACTIONS.map((row) => ({ label: t(row.labelKey), keys: row.keys }));

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className={styles.overlay} onClick={onClose} role="dialog" aria-label={t('title')}>
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>{t('title')}</span>
          <span className={styles.hint}>{t('escHint')}</span>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionTitle}>{t('navigation')}</div>
          {navigationRows.map((row) => (
            <div key={row.label + row.keys.join('')} className={styles.row}>
              <span className={styles.label}>{row.label}</span>
              <span className={styles.keys}>
                {row.keys.map((k, i) => (
                  <kbd key={i} className={styles.kbd}>
                    {k}
                  </kbd>
                ))}
              </span>
            </div>
          ))}
        </div>

        <div className={styles.section}>
          <div className={styles.sectionTitle}>{t('actions')}</div>
          {actionRows.map((row) => (
            <div key={row.label + row.keys.join('')} className={styles.row}>
              <span className={styles.label}>{row.label}</span>
              <span className={styles.keys}>
                {row.keys.map((k, i) => (
                  <kbd key={i} className={styles.kbd}>
                    {k}
                  </kbd>
                ))}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
