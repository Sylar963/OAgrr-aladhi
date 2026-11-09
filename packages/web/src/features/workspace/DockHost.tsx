import {
  type DockviewApi,
  DockviewReact,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
  type IWatermarkPanelProps,
  type SerializedDockview,
  themeDark,
} from 'dockview-react';
import 'dockview-react/dist/styles/dockview.css';
import './dockview-theme.css';
import { readLayout, removeLayout, writeLayout } from '@lib/custom-tabs';
import { registerAppDocument } from '@lib/app-visibility';
import { defineMessages, useT } from '@lib/i18n';
import { PanelDocumentContext } from '@lib/panel-document';
import { builtinTabFromLayoutId, type WidgetInstance } from '@lib/workspace-layouts';
import {
  selectActiveCustomTab,
  selectLayoutPanels,
  selectLayoutPreset,
  useAppStore,
} from '@stores/app-store';
import { useCallback, useEffect, useRef, useState } from 'react';

import styles from './DockHost.module.css';
import PanelWindowControls, { dockPopoutWindow } from './PanelWindowControls';
import { syncPopoutDocument, WORKSPACE_POPOUT_URL } from './popout-document';
import { useWorkspaceTemplates } from './template-picker-context';
import WidgetFrame from './WidgetFrame';
import { useWidgetCatalog } from './widget-catalog';

const LAYOUT_SAVE_DELAY_MS = 300;
const GROUP_CONSTRAINTS = { minimumWidth: 320, minimumHeight: 200 };

const messages = defineMessages(
  {
    empty: 'Make this workspace yours.',
    hint: 'Start with a ready-made setup, or add individual panels with + Widget.',
    choose: 'Choose a template',
    onScreens: 'Your panels are open in other windows.',
    bringBack: 'Bring panels back',
    blocked:
      'The panel window could not open. Allow pop-ups for this site and try again. Your panels stay in the workspace.',
    dismiss: 'Dismiss',
  },
  {
    empty: 'Haz tuyo este espacio.',
    hint: 'Empieza con una configuración lista, o agrega paneles con + Widget.',
    choose: 'Elegir una plantilla',
    onScreens: 'Tus paneles están abiertos en otras ventanas.',
    bringBack: 'Traer los paneles de vuelta',
    blocked:
      'No se pudo abrir la ventana. Permite ventanas emergentes para este sitio e inténtalo de nuevo. Tus paneles siguen en el espacio.',
    dismiss: 'Cerrar aviso',
  },
);

// Dockview's default renderer only detaches a hidden panel's DOM and leaves its React tree mounted,
// which would keep the widget's sockets and timers running. Rendering nothing unmounts them.
export function WidgetPanel({ api, params }: IDockviewPanelProps<WidgetInstance>) {
  const catalog = useWidgetCatalog();
  const [visible, setVisible] = useState(api.isVisible);
  const [ownerDocument, setOwnerDocument] = useState(() =>
    api.location?.type === 'popout' ? api.location.getWindow().document : document,
  );

  useEffect(() => {
    setVisible(api.isVisible);
    const subscription = api.onDidVisibilityChange((event) => setVisible(event.isVisible));
    const location = api.onDidLocationChange(() => {
      setOwnerDocument(
        api.location.type === 'popout' ? api.location.getWindow().document : document,
      );
    });
    return () => {
      subscription.dispose();
      location.dispose();
    };
  }, [api]);

  if (!visible) return null;
  return (
    <PanelDocumentContext.Provider value={ownerDocument}>
      <div className={styles.panel}>
        <WidgetFrame
          kind={params.kind}
          label={catalog.find((widget) => widget.kind === params.kind)?.label}
          underlying={params.underlying}
        />
      </div>
    </PanelDocumentContext.Provider>
  );
}

function EmptyTabHint({ containerApi }: IWatermarkPanelProps) {
  const t = useT(messages);
  const openTemplates = useWorkspaceTemplates();
  const tabId = useAppStore((s) => selectActiveCustomTab(s)?.id);
  const [hasPopouts, setHasPopouts] = useState(() => containerApi.getPopouts().length > 0);
  useEffect(() => {
    const update = () => setHasPopouts(containerApi.getPopouts().length > 0);
    const added = containerApi.onDidAddPopoutGroup(update);
    const removed = containerApi.onDidRemovePopoutGroup(update);
    return () => {
      added.dispose();
      removed.dispose();
    };
  }, [containerApi]);
  return (
    <div className={styles.empty}>
      <span className={styles.emptyIcon} aria-hidden="true">
        ▦
      </span>
      <strong>{t(hasPopouts ? 'onScreens' : 'empty')}</strong>
      {!hasPopouts && <span>{t('hint')}</span>}
      <button
        type="button"
        onClick={() => {
          if (hasPopouts) {
            for (const popout of containerApi.getPopouts())
              dockPopoutWindow(containerApi, popout.window);
          } else openTemplates(tabId);
        }}
      >
        {t(hasPopouts ? 'bringBack' : 'choose')}
      </button>
    </div>
  );
}

function WorkspaceWatermark(props: IWatermarkPanelProps) {
  return props.group ? null : <EmptyTabHint {...props} />;
}

const COMPONENTS = { widget: WidgetPanel };

export default function DockHost({ layoutId }: { layoutId: string }) {
  const t = useT(messages);
  const panels = useAppStore((s) => selectLayoutPanels(s, layoutId));
  const preset = useAppStore((s) => selectLayoutPreset(s, layoutId));
  const revision = useAppStore((s) => s.layoutRevision);
  const focusRequest = useAppStore((s) => s.widgetFocusRequest);
  const clearWidgetFocus = useAppStore((s) => s.clearWidgetFocus);
  const setLayoutPanels = useAppStore((s) => s.setLayoutPanels);
  const catalog = useWidgetCatalog();
  const [api, setApi] = useState<DockviewApi | null>(null);
  const restored = useRef(false);
  const [popoutFailed, setPopoutFailed] = useState(false);
  const initialized = useRef(false);

  const onReady = useCallback((event: DockviewReadyEvent) => setApi(event.api), []);

  useEffect(() => {
    if (api == null) return;
    const cleanups = new Map<Window, () => void>();
    const opened = api.onDidAddPopoutGroup(({ window: target }) => {
      const stopStyles = syncPopoutDocument(document, target.document);
      const stopVisibility = registerAppDocument(target.document);
      cleanups.set(target, () => {
        stopStyles();
        stopVisibility();
      });
      target.focus();
    });
    const closing = api.onWillClosePopoutWindow(({ window: target }) => {
      cleanups.get(target)?.();
      cleanups.delete(target);
    });
    const failed = api.onDidOpenPopoutWindowFail(() => setPopoutFailed(true));
    const saved = readLayout(layoutId);
    if (saved != null) {
      try {
        const layout = saved as SerializedDockview;
        const expected = selectLayoutPanels(useAppStore.getState(), layoutId);
        const legacyStats = Object.entries(layout.panels).find(
          ([, panel]) => panel.params?.kind === 'chain-stats',
        );
        const chainTable = expected.find((panel) => panel.kind === 'chain-table');
        const valid = Object.entries(layout.panels).every(
          ([id, panel]) =>
            (id === legacyStats?.[0] && chainTable != null) ||
            expected.some(
              (entry) =>
                entry.id === id &&
                entry.kind === panel.params?.kind &&
                entry.underlying === panel.params?.underlying,
            ),
        );
        if (!valid) throw new Error('Invalid layout panels');
        for (const [id, panel] of Object.entries(layout.panels)) {
          panel.params =
            id === legacyStats?.[0]
              ? { id, kind: 'chain-table' }
              : expected.find((entry) => entry.id === id);
        }
        for (const popout of layout.popoutGroups ?? []) popout.url = WORKSPACE_POPOUT_URL;
        api.fromJSON(layout);
        if (legacyStats && chainTable) {
          if (!api.getPanel(chainTable.id)) {
            api.addPanel({
              id: chainTable.id,
              component: 'widget',
              title: layout.panels[legacyStats[0]]?.title ?? chainTable.kind,
              params: chainTable,
              position: { referencePanel: legacyStats[0], direction: 'within' },
            });
          }
          api.getPanel(legacyStats[0])?.api.close();
        }
        restored.current = true;
      } catch {
        api.clear();
        removeLayout(layoutId);
      }
    }
    return () => {
      opened.dispose();
      closing.dispose();
      failed.dispose();
      for (const cleanup of cleanups.values()) cleanup();
    };
  }, [api, layoutId]);

  useEffect(() => {
    if (api == null) return;
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    let syncTimer: ReturnType<typeof setTimeout> | null = null;
    const canSave = () => {
      const s = useAppStore.getState();
      return (
        s.layoutRevision === revision &&
        (builtinTabFromLayoutId(layoutId) != null ||
          s.customTabs.some((tab) => tab.id === layoutId))
      );
    };
    const syncPanels = () => {
      if (!canSave()) return;
      const current = selectLayoutPanels(useAppStore.getState(), layoutId);
      const next = current.filter((panel) => api.getPanel(panel.id) != null);
      if (next.length !== current.length) setLayoutPanels(layoutId, next);
    };
    const save = () => {
      if (!canSave()) return;
      syncPanels();
      writeLayout(layoutId, api.toJSON());
    };

    const layoutChange = api.onDidLayoutChange(() => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        saveTimer = null;
        save();
      }, LAYOUT_SAVE_DELAY_MS);
    });
    const onPanelsChanged = () => {
      if (syncTimer) clearTimeout(syncTimer);
      syncTimer = setTimeout(() => {
        syncTimer = null;
        syncPanels();
      }, 0);
    };
    for (const group of api.groups) group.api.setConstraints(GROUP_CONSTRAINTS);
    const groupAdded = api.onDidAddGroup((group) => group.api.setConstraints(GROUP_CONSTRAINTS));
    const added = api.onDidAddPanel(onPanelsChanged);
    const removed = api.onDidRemovePanel(onPanelsChanged);

    return () => {
      layoutChange.dispose();
      groupAdded.dispose();
      added.dispose();
      removed.dispose();
      if (syncTimer) clearTimeout(syncTimer);
      if (saveTimer) {
        clearTimeout(saveTimer);
        save();
      }
    };
  }, [api, layoutId, revision, setLayoutPanels]);

  useEffect(() => {
    if (api == null) return;
    for (const panel of api.panels) {
      if (!panels.some((entry) => entry.id === panel.id)) panel.api.close();
    }
    const builtin = builtinTabFromLayoutId(layoutId);
    const groupAnchors = new Map<number, string>();
    for (const panel of panels) {
      const label = catalog.find((widget) => widget.kind === panel.kind)?.label ?? panel.kind;
      const title = panel.underlying ? `${panel.underlying} · ${label}` : label;
      const group = preset.find((entry) => entry.id === panel.id)?.group ?? 0;
      const anchor = groupAnchors.get(group);
      groupAnchors.set(group, anchor ?? panel.id);
      const existing = api.getPanel(panel.id);
      if (existing) {
        if (existing.title !== title) existing.api.setTitle(title);
        continue;
      }
      const usePreset = !initialized.current && !restored.current && preset.length > 0;
      const reference = anchor ?? groupAnchors.get(group === 3 ? 1 : 0);
      api.addPanel({
        id: panel.id,
        component: 'widget',
        title,
        params: panel,
        inactive: !initialized.current && anchor != null,
        ...(usePreset && reference && reference !== panel.id
          ? {
              position: {
                referencePanel: reference,
                direction: anchor
                  ? 'within'
                  : builtin === 'chain'
                    ? 'left'
                    : group === 1
                      ? 'right'
                      : 'below',
              },
              ...(builtin === 'chain' && group === 2 ? { initialWidth: 320 } : {}),
            }
          : {}),
      });
    }
    initialized.current = true;
  }, [api, panels, catalog, layoutId, preset]);

  useEffect(() => {
    if (api == null || focusRequest == null) return;
    api.getPanel(focusRequest)?.api.setActive();
    clearWidgetFocus();
  }, [api, focusRequest, clearWidgetFocus]);

  return (
    <div className={styles.host}>
      {popoutFailed && (
        <div className={styles.notice} role="alert">
          <span>{t('blocked')}</span>
          <button type="button" onClick={() => setPopoutFailed(false)}>
            {t('dismiss')}
          </button>
        </div>
      )}
      <DockviewReact
        components={COMPONENTS}
        theme={themeDark}
        watermarkComponent={WorkspaceWatermark}
        rightHeaderActionsComponent={PanelWindowControls}
        popoutUrl={WORKSPACE_POPOUT_URL}
        disableFloatingGroups
        onReady={onReady}
      />
    </div>
  );
}
