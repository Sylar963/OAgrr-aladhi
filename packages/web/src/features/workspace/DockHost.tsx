import {
  type DockviewApi,
  DockviewReact,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
  type SerializedDockview,
  themeDark,
} from 'dockview-react';
import 'dockview-react/dist/styles/dockview.css';
import './dockview-theme.css';
import { readLayout, removeLayout, writeLayout } from '@lib/custom-tabs';
import { defineMessages, useT } from '@lib/i18n';
import { isWidgetKind, useTabs, type WidgetKind } from '@lib/tabs';
import { useAppStore } from '@stores/app-store';
import { useCallback, useEffect, useState } from 'react';

import styles from './DockHost.module.css';
import WidgetFrame from './WidgetFrame';

const LAYOUT_SAVE_DELAY_MS = 300;
const NO_KINDS: WidgetKind[] = [];

const messages = defineMessages(
  { empty: 'Add a widget to start this tab.' },
  { empty: 'Agrega un widget para empezar esta pestaña.' },
);

// Dockview's default renderer only detaches a hidden panel's DOM and leaves its React tree mounted,
// which would keep the widget's sockets and timers running. Rendering nothing unmounts them.
export function WidgetPanel({ api, params }: IDockviewPanelProps<{ kind: WidgetKind }>) {
  const [visible, setVisible] = useState(api.isVisible);

  useEffect(() => {
    setVisible(api.isVisible);
    const subscription = api.onDidVisibilityChange((event) => setVisible(event.isVisible));
    return () => subscription.dispose();
  }, [api]);

  if (!visible) return null;
  return (
    <div className={styles.panel}>
      <WidgetFrame kind={params.kind} />
    </div>
  );
}

function EmptyTabHint() {
  const t = useT(messages);
  return <div className={styles.empty}>{t('empty')}</div>;
}

const COMPONENTS = { widget: WidgetPanel };

function panelKinds(api: DockviewApi): WidgetKind[] {
  return api.panels.map((panel) => panel.id).filter(isWidgetKind);
}

export default function DockHost({ tabId }: { tabId: string }) {
  const kinds = useAppStore(
    (s) => s.customTabs.find((tab) => tab.id === tabId)?.kinds ?? NO_KINDS,
  );
  const focusRequest = useAppStore((s) => s.widgetFocusRequest);
  const setCustomTabKinds = useAppStore((s) => s.setCustomTabKinds);
  const tabs = useTabs();
  const [api, setApi] = useState<DockviewApi | null>(null);

  const onReady = useCallback(
    (event: DockviewReadyEvent) => {
      const saved = readLayout(tabId);
      if (saved != null) {
        try {
          event.api.fromJSON(saved as SerializedDockview);
        } catch {
          event.api.clear();
          removeLayout(tabId);
        }
      }
      setApi(event.api);
    },
    [tabId],
  );

  useEffect(() => {
    if (api == null) return;
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    let syncTimer: ReturnType<typeof setTimeout> | null = null;

    // Resize drags fire this continuously; serializing belongs after the drag, never during it.
    const layoutChange = api.onDidLayoutChange(() => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        saveTimer = null;
        writeLayout(tabId, api.toJSON());
      }, LAYOUT_SAVE_DELAY_MS);
    });

    // Moving a panel between groups fires remove then add, so read the result once they settle.
    const syncKinds = () => {
      if (syncTimer) clearTimeout(syncTimer);
      syncTimer = setTimeout(() => {
        syncTimer = null;
        const next = panelKinds(api);
        const current = useAppStore.getState().customTabs.find((tab) => tab.id === tabId)?.kinds;
        if (current == null) return;
        const same =
          current.length === next.length && current.every((kind) => next.includes(kind));
        if (!same) setCustomTabKinds(tabId, next);
      }, 0);
    };
    const added = api.onDidAddPanel(syncKinds);
    const removed = api.onDidRemovePanel(syncKinds);

    return () => {
      layoutChange.dispose();
      added.dispose();
      removed.dispose();
      if (syncTimer) clearTimeout(syncTimer);
      if (saveTimer) {
        clearTimeout(saveTimer);
        writeLayout(tabId, api.toJSON());
      }
    };
  }, [api, tabId, setCustomTabKinds]);

  useEffect(() => {
    if (api == null) return;
    for (const panel of api.panels) {
      if (!kinds.includes(panel.id as WidgetKind)) panel.api.close();
    }
    for (const kind of kinds) {
      const title = tabs.find((tab) => tab.id === kind)?.label ?? kind;
      const existing = api.getPanel(kind);
      if (existing) {
        if (existing.title !== title) existing.api.setTitle(title);
        continue;
      }
      api.addPanel({ id: kind, component: 'widget', title, params: { kind } });
    }
  }, [api, kinds, tabs]);

  useEffect(() => {
    if (api == null || focusRequest == null) return;
    api.getPanel(focusRequest.kind)?.api.setActive();
  }, [api, focusRequest]);

  return (
    <div className={styles.host}>
      <DockviewReact
        components={COMPONENTS}
        theme={themeDark}
        watermarkComponent={EmptyTabHint}
        disableFloatingGroups
        onReady={onReady}
      />
    </div>
  );
}
