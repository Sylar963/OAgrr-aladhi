import DropdownPicker from '@components/ui/DropdownPicker';
import { MAX_TAB_NAME_LENGTH, MAX_WIDGETS_PER_TAB } from '@lib/custom-tabs';
import { defineMessages, useT } from '@lib/i18n';
import { isWidgetKind } from '@lib/tabs';
import { selectActiveCustomTab, useAppStore } from '@stores/app-store';
import { type PointerEvent as ReactPointerEvent, useState } from 'react';

import { useWidgetCatalog } from './widget-catalog';
import styles from './WorkspaceBar.module.css';

const messages = defineMessages(
  {
    addWidget: '+ Widget',
    rename: 'Double-click to rename, drag to reorder',
    close: 'Close {name}',
    closeConfirm: 'Close {name}? Its layout will be deleted.',
  },
  {
    addWidget: '+ Widget',
    rename: 'Doble clic para renombrar, arrastra para reordenar',
    close: 'Cerrar {name}',
    closeConfirm: '¿Cerrar {name}? Se borrará su diseño.',
  },
);

const DRAG_THRESHOLD_PX = 5;

/** The index a dragged tab belongs at, given the horizontal midpoints of the tabs around it. */
export function reorderIndex(midpoints: readonly number[], from: number, pointerX: number): number {
  let index = 0;
  midpoints.forEach((midpoint, i) => {
    if (i !== from && pointerX > midpoint) index += 1;
  });
  return index;
}

export default function WorkspaceBar() {
  const t = useT(messages);
  const customTabs = useAppStore((s) => s.customTabs);
  const activeTab = useAppStore(selectActiveCustomTab);
  const openCustomTab = useAppStore((s) => s.openCustomTab);
  const renameCustomTab = useAppStore((s) => s.renameCustomTab);
  const closeCustomTab = useAppStore((s) => s.closeCustomTab);
  const moveCustomTab = useAppStore((s) => s.moveCustomTab);
  const addWidget = useAppStore((s) => s.addWidget);
  const catalog = useWidgetCatalog();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const available = activeTab
    ? catalog.filter((widget) => !activeTab.kinds.includes(widget.kind))
    : [];
  const canAdd =
    activeTab != null && activeTab.kinds.length < MAX_WIDGETS_PER_TAB && available.length > 0;

  // Tracked on the window, because pointer capture is lost when React moves the dragged tab's node.
  function startReorder(id: string, event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || (event.target as HTMLElement).closest('input')) return;
    const list = event.currentTarget.parentElement;
    if (!list) return;
    const startX = event.clientX;
    const pointerId = event.pointerId;
    let dragging = false;

    const onMove = (move: PointerEvent) => {
      if (move.pointerId !== pointerId) return;
      if (!dragging) {
        if (Math.abs(move.clientX - startX) < DRAG_THRESHOLD_PX) return;
        dragging = true;
        setDraggingId(id);
      }
      const from = useAppStore.getState().customTabs.findIndex((tab) => tab.id === id);
      const midpoints = [...list.children].map((child) => {
        const rect = child.getBoundingClientRect();
        return rect.left + rect.width / 2;
      });
      moveCustomTab(id, reorderIndex(midpoints, from, move.clientX));
    };
    const onEnd = (end: PointerEvent) => {
      if (end.pointerId !== pointerId) return;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      if (!dragging) return;
      setDraggingId(null);
      // The release would otherwise count as a click on whichever tab is under the pointer.
      const swallowClick = (click: MouseEvent) => click.stopPropagation();
      window.addEventListener('click', swallowClick, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallowClick, { capture: true }), 0);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
  }

  function commitRename(id: string, value: string) {
    const name = value.trim();
    if (name) renameCustomTab(id, name);
    setEditingId(null);
  }

  return (
    <div className={styles.bar}>
      <div className={styles.tabs} role="tablist">
        {customTabs.map((tab) => (
          <div
            key={tab.id}
            className={styles.tab}
            data-active={tab.id === activeTab?.id}
            data-dragging={tab.id === draggingId || undefined}
            onPointerDown={(event) => startReorder(tab.id, event)}
          >
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
