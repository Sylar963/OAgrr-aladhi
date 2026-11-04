import { act, cleanup, render, screen } from '@testing-library/react';
import type { IDockviewPanelProps } from 'dockview-react';
import { MAIN_MARKET_ID, useAppStore } from '@stores/app-store';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import DockHost, { WidgetPanel } from './DockHost';

const lifecycle = { mounts: 0, unmounts: 0 };
vi.mock('dockview-react', async (importOriginal) => {
  const { useEffect: useMountEffect } = await import('react');
  return {
    ...(await importOriginal<typeof import('dockview-react')>()),
    DockviewReact: ({ onReady }: { onReady: (event: { api: unknown }) => void }) => {
      useMountEffect(() => onReady({ api: currentDock() }), [onReady]);
      return null;
    },
  };
});

let currentDock: () => unknown = () => null;

vi.mock('./WidgetFrame', () => ({
  default: ({ kind }: { kind: string }) => {
    useEffect(() => {
      lifecycle.mounts += 1;
      return () => {
        lifecycle.unmounts += 1;
      };
    }, []);
    return <div>widget:{kind}</div>;
  },
}));

function fakePanelApi(isVisible: boolean) {
  const listeners = new Set<(event: { isVisible: boolean }) => void>();
  return {
    isVisible,
    onDidVisibilityChange: (listener: (event: { isVisible: boolean }) => void) => {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    fire: (next: boolean) => {
      for (const listener of listeners) listener({ isVisible: next });
    },
    listenerCount: () => listeners.size,
  };
}

function renderPanel(api: ReturnType<typeof fakePanelApi>) {
  const props = { api, params: { kind: 'chain' } } as unknown as IDockviewPanelProps<{
    kind: 'chain';
  }>;
  return render(<WidgetPanel {...props} />);
}

describe('WidgetPanel', () => {
  afterEach(() => {
    cleanup();
    lifecycle.mounts = 0;
    lifecycle.unmounts = 0;
  });

  it('renders the widget while visible', () => {
    renderPanel(fakePanelApi(true));
    expect(screen.getByText('widget:chain')).toBeDefined();
  });

  it('never mounts a widget that starts hidden', () => {
    renderPanel(fakePanelApi(false));
    expect(screen.queryByText('widget:chain')).toBeNull();
    expect(lifecycle.mounts).toBe(0);
  });

  it('unmounts the widget when hidden, so it holds no sockets or timers', () => {
    const api = fakePanelApi(true);
    renderPanel(api);
    expect(lifecycle.mounts).toBe(1);

    act(() => api.fire(false));

    expect(screen.queryByText('widget:chain')).toBeNull();
    expect(lifecycle.unmounts).toBe(1);
  });

  it('mounts the widget again when shown', () => {
    const api = fakePanelApi(true);
    renderPanel(api);
    act(() => api.fire(false));
    act(() => api.fire(true));

    expect(screen.getByText('widget:chain')).toBeDefined();
    expect(lifecycle.mounts).toBe(2);
  });

  it('stops listening once unmounted', () => {
    const api = fakePanelApi(true);
    const { unmount } = renderPanel(api);
    expect(api.listenerCount()).toBe(1);

    unmount();
    expect(api.listenerCount()).toBe(0);
  });
});

// Drives DockHost through a fake dockview, so the behaviour around its teardown is under test.
describe('DockHost', () => {
  function fakeDock() {
    const listeners = { layout: new Set<() => void>(), add: new Set<() => void>(), remove: new Set<() => void>() };
    const on = (set: Set<() => void>) => (listener: () => void) => {
      set.add(listener);
      return { dispose: () => set.delete(listener) };
    };
    const panels: { id: string; title: string; api: { close: () => void; setTitle: (t: string) => void; setActive: () => void } }[] = [];
    const setActive = vi.fn();
    const api = {
      panels,
      groups: [],
      setActive,
      onDidLayoutChange: on(listeners.layout),
      onDidAddPanel: on(listeners.add),
      onDidRemovePanel: on(listeners.remove),
      onDidAddGroup: () => ({ dispose: () => {} }),
      fromJSON: vi.fn(),
      clear: vi.fn(),
      toJSON: () => ({ grid: {}, panels: {} }),
      getPanel: (id: string) => panels.find((panel) => panel.id === id),
      addPanel: ({ id, title }: { id: string; title: string }) => {
        panels.push({ id, title, api: { close: () => {}, setTitle: () => {}, setActive: () => setActive(id) } });
      },
    };
    return { api, fireLayout: () => listeners.layout.forEach((l) => l()) };
  }

  let dock = fakeDock();

  beforeEach(() => {
    dock = fakeDock();
    currentDock = () => dock.api;
    vi.useFakeTimers();
    localStorage.clear();
    useAppStore.setState({ customTabs: [], widgetFocusRequest: null, activeMarketId: MAIN_MARKET_ID });
    useAppStore.getState().createCustomTab('Desk');
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const tabId = () => useAppStore.getState().activeMarketId;
  const layoutKey = () => `ogg.customTabLayout.v1.${tabId()}`;

  it('keeps a closed tab\'s layout deleted when a save was still pending', () => {
    const id = tabId();
    const key = layoutKey();
    const { unmount } = render(<DockHost tabId={id} />);
    act(() => dock.fireLayout());

    act(() => useAppStore.getState().closeCustomTab(id));
    unmount();
    vi.advanceTimersByTime(1_000);

    expect(localStorage.getItem(key)).toBeNull();
  });

  it('saves a pending layout when leaving a tab that stays open', () => {
    const key = layoutKey();
    const { unmount } = render(<DockHost tabId={tabId()} />);
    act(() => dock.fireLayout());

    unmount();

    expect(localStorage.getItem(key)).not.toBeNull();
  });

  it('waits for the layout to settle before serializing', () => {
    const key = layoutKey();
    render(<DockHost tabId={tabId()} />);
    act(() => dock.fireLayout());
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(localStorage.getItem(key)).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(localStorage.getItem(key)).not.toBeNull();
  });

  it('focuses a requested widget once, not again on the next mount', () => {
    useAppStore.getState().addWidget('architect');
    useAppStore.getState().navigateToWidget('architect');

    const first = render(<DockHost tabId={tabId()} />);
    expect(dock.api.setActive).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().widgetFocusRequest).toBeNull();
    first.unmount();

    render(<DockHost tabId={tabId()} />);
    expect(dock.api.setActive).toHaveBeenCalledTimes(1);
  });
});
