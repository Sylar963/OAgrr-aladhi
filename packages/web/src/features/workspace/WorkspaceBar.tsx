import { AssetPickerButton, VenuePickerButton } from '@components/ui';
import DropdownPicker from '@components/ui/DropdownPicker';
import { MAX_TAB_NAME_LENGTH } from '@lib/custom-tabs';
import { defineMessages, useT } from '@lib/i18n';
import { useTabs } from '@lib/tabs';
import {
  builtinTabFromLayoutId,
  canAddPanel,
  PRESETS,
  type WidgetInstance,
} from '@lib/workspace-layouts';
import { WORKSPACE_TEMPLATES } from '@lib/workspace-templates';
import {
  selectActiveCustomTab,
  selectActiveLayoutId,
  selectLayoutPanels,
  useAppStore,
} from '@stores/app-store';
import { type PointerEvent as ReactPointerEvent, useState } from 'react';
import { useWorkspaceTemplates } from './template-picker-context';
import styles from './WorkspaceBar.module.css';
import { useWidgetCatalog } from './widget-catalog';

const messages = defineMessages(
  {
    addWidget: '+ Widget',
    rename: 'Double-click to rename, drag to reorder',
    close: 'Close {name}',
    closeConfirm: 'Close {name}? Its layout will be deleted.',
    reset: 'Reset layout',
    clear: 'Clear layout',
    resetConfirm: 'Restore the default panel arrangement? Your layout changes will be removed.',
    clearConfirm: 'Remove all panels from this custom tab?',
    panels: '{n} panels',
    templates: 'Templates',
    resetTemplate: 'Reset template',
    resetTemplateConfirm: 'Restore this template’s starting panels and arrangement?',
  },
  {
    addWidget: '+ Widget',
    rename: 'Doble clic para renombrar, arrastra para reordenar',
    close: 'Cerrar {name}',
    closeConfirm: '¿Cerrar {name}? Se borrará su diseño.',
    reset: 'Restablecer diseño',
    clear: 'Vaciar diseño',
    resetConfirm: '¿Restaurar la disposición predeterminada? Se quitarán tus cambios al diseño.',
    clearConfirm: '¿Quitar todos los paneles de esta pestaña personalizada?',
    panels: '{n} paneles',
    templates: 'Plantillas',
    resetTemplate: 'Restablecer plantilla',
    resetTemplateConfirm: '¿Restaurar los paneles y la disposición inicial de esta plantilla?',
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
  const layoutId = useAppStore(selectActiveLayoutId);
  const panels = useAppStore((s) => selectLayoutPanels(s, layoutId));
  const builtin = builtinTabFromLayoutId(layoutId);
  const addWidget = useAppStore((s) => s.addWidget);
  const resetActiveLayout = useAppStore((s) => s.resetActiveLayout);
  const tabs = useTabs();
  const catalog = useWidgetCatalog();
  const openTemplates = useWorkspaceTemplates();
  const hasTemplate =
    activeTab?.templateId && WORKSPACE_TEMPLATES[activeTab.templateId].panels.length > 0;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const candidates: WidgetInstance[] = [
    ...(builtin ? PRESETS[builtin].map(({ group: _group, ...panel }) => panel) : []),
    ...catalog.map(({ kind }) => ({ id: kind, kind })),
  ];
  const available = candidates.filter(
    (panel, index) =>
      candidates.findIndex((entry) => entry.id === panel.id) === index &&
      canAddPanel(panels, panel, builtin),
  );
  const panelLabel = (panel: WidgetInstance) => {
    const label = catalog.find((entry) => entry.kind === panel.kind)?.label ?? panel.kind;
    return panel.underlying ? `${panel.underlying} · ${label}` : label;
  };

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
      <div className={styles.context}>
        <span className={styles.layoutName}>
          {activeTab?.name ?? tabs.find((tab) => tab.id === builtin)?.label}
        </span>
        <span className={styles.count}>{t('panels', { n: panels.length })}</span>
        <AssetPickerButton />
        <VenuePickerButton />
      </div>
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
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.templates}
          onClick={() => openTemplates(activeTab?.kinds.length === 0 ? activeTab.id : undefined)}
        >
          <span aria-hidden="true">▦</span> {t('templates')}
        </button>
        {available.length > 0 && (
          <DropdownPicker
            size="sm"
            value={t('addWidget')}
            options={available.map((panel) => ({ value: panel.id, label: panelLabel(panel) }))}
            onChange={(id) => {
              const panel = available.find((entry) => entry.id === id);
              if (panel) addWidget(panel);
            }}
          />
        )}
        <button
          type="button"
          className={styles.reset}
          onClick={() => {
            if (
              window.confirm(
                t(builtin ? 'resetConfirm' : hasTemplate ? 'resetTemplateConfirm' : 'clearConfirm'),
              )
            )
              resetActiveLayout();
          }}
        >
          {t(builtin ? 'reset' : hasTemplate ? 'resetTemplate' : 'clear')}
        </button>
      </div>
    </div>
  );
}
