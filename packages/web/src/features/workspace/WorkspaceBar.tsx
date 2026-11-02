import DropdownPicker from '@components/ui/DropdownPicker';
import { MAX_TAB_NAME_LENGTH, MAX_WIDGETS_PER_TAB } from '@lib/custom-tabs';
import { defineMessages, useT } from '@lib/i18n';
import { isWidgetKind } from '@lib/tabs';
import { selectActiveCustomTab, useAppStore } from '@stores/app-store';
import { useState } from 'react';

import { useWidgetCatalog } from './widget-catalog';
import styles from './WorkspaceBar.module.css';

const messages = defineMessages(
  {
    addWidget: '+ Widget',
    rename: 'Double-click to rename',
    close: 'Close {name}',
    closeConfirm: 'Close {name}? Its layout will be deleted.',
  },
  {
    addWidget: '+ Widget',
    rename: 'Doble clic para renombrar',
    close: 'Cerrar {name}',
    closeConfirm: '¿Cerrar {name}? Se borrará su diseño.',
  },
);

export default function WorkspaceBar() {
  const t = useT(messages);
  const customTabs = useAppStore((s) => s.customTabs);
  const activeTab = useAppStore(selectActiveCustomTab);
  const openCustomTab = useAppStore((s) => s.openCustomTab);
  const renameCustomTab = useAppStore((s) => s.renameCustomTab);
  const closeCustomTab = useAppStore((s) => s.closeCustomTab);
  const addWidget = useAppStore((s) => s.addWidget);
  const catalog = useWidgetCatalog();
  const [editingId, setEditingId] = useState<string | null>(null);

  const available = activeTab
    ? catalog.filter((widget) => !activeTab.kinds.includes(widget.kind))
    : [];
  const canAdd =
    activeTab != null && activeTab.kinds.length < MAX_WIDGETS_PER_TAB && available.length > 0;

  function commitRename(id: string, value: string) {
    const name = value.trim();
    if (name) renameCustomTab(id, name);
    setEditingId(null);
  }

  return (
    <div className={styles.bar}>
      <div className={styles.tabs} role="tablist">
        {customTabs.map((tab) => (
          <div key={tab.id} className={styles.tab} data-active={tab.id === activeTab?.id}>
            {editingId === tab.id ? (
              <input
                className={styles.nameInput}
                defaultValue={tab.name}
                maxLength={MAX_TAB_NAME_LENGTH}
                autoFocus
                onFocus={(event) => event.target.select()}
                onBlur={(event) => commitRename(tab.id, event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') commitRename(tab.id, event.currentTarget.value);
                  if (event.key === 'Escape') setEditingId(null);
                }}
              />
            ) : (
              <button
                type="button"
                role="tab"
                aria-selected={tab.id === activeTab?.id}
                className={styles.name}
                title={t('rename')}
                onClick={() => openCustomTab(tab.id)}
                onDoubleClick={() => setEditingId(tab.id)}
              >
                {tab.name}
              </button>
            )}
            <button
              type="button"
              className={styles.close}
              aria-label={t('close', { name: tab.name })}
              onClick={() => {
                const hasWidgets = tab.kinds.length > 0;
                if (hasWidgets && !window.confirm(t('closeConfirm', { name: tab.name }))) return;
                closeCustomTab(tab.id);
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      {canAdd && (
        <DropdownPicker
          size="sm"
          value={t('addWidget')}
          options={available.map((widget) => ({ value: widget.kind, label: widget.label }))}
          onChange={(kind) => {
            if (isWidgetKind(kind)) addWidget(kind);
          }}
        />
      )}
    </div>
  );
}
