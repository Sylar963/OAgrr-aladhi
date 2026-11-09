import { readLayout, writeLayout } from '@lib/custom-tabs';
import { builtinLayoutId, readBuiltinLayouts } from '@lib/workspace-layouts';
import { MAIN_MARKET_ID, useAppStore } from '@stores/app-store';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { IDockviewPanelProps, SerializedDockview } from 'dockview-react';
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
    location: { type: 'grid' },
    onDidLocationChange: () => ({ dispose: () => {} }),
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
  const props = { api, params: { id: 'chain', kind: 'chain' } } as unknown as IDockviewPanelProps<{
    id: 'chain';
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
    const listeners = {
      layout: new Set<() => void>(),
      add: new Set<() => void>(),
      remove: new Set<() => void>(),
      failure: new Set<() => void>(),
    };
    const on = (set: Set<() => void>) => (listener: () => void) => {
      set.add(listener);
      return { dispose: () => set.delete(listener) };
    };
    const panels: {
      id: string;
      title: string;
      api: { close: () => void; setTitle: (t: string) => void; setActive: () => void };
    }[] = [];
    const setActive = vi.fn();
    const api = {
      panels,
      groups: [],
      setActive,
      onDidLayoutChange: on(listeners.layout),
      onDidAddPanel: on(listeners.add),
      onDidRemovePanel: on(listeners.remove),
      onDidAddGroup: () => ({ dispose: () => {} }),
      onDidAddPopoutGroup: () => ({ dispose: () => {} }),
      onWillClosePopoutWindow: () => ({ dispose: () => {} }),
      onDidOpenPopoutWindowFail: on(listeners.failure),
      fromJSON: vi.fn((layout: SerializedDockview) => {
        for (const [id, panel] of Object.entries(layout.panels)) {
          api.addPanel({ id, title: panel.title ?? id });
        }
      }),
      clear: vi.fn(),
      toJSON: () => ({ grid: {}, panels: {} }),
      getPanel: (id: string) => panels.find((panel) => panel.id === id),
      addPanel: vi.fn(({ id, title }: { id: string; title: string }) => {
        panels.push({
          id,
          title,
          api: {
            close: () => {
              panels.splice(
                panels.findIndex((panel) => panel.id === id),
                1,
              );
              for (const listener of listeners.remove) listener();
              for (const listener of listeners.layout) listener();
            },
            setTitle: () => {},
            setActive: () => setActive(id),
          },
        });
      }),
    };
    return {
      api,
      fireFailure: () => {
        for (const listener of listeners.failure) listener();
      },
      fireLayout: () => {
        for (const listener of listeners.layout) listener();
      },
    };
  }

  let dock = fakeDock();

  beforeEach(() => {
    dock = fakeDock();
    currentDock = () => dock.api;
    vi.useFakeTimers();
    localStorage.clear();
    useAppStore.setState({
      customTabs: [],
      builtinLayouts: {},
      layoutRevision: 0,
      activeTab: 'chain',
      widgetFocusRequest: null,
      activeMarketId: MAIN_MARKET_ID,
    });
    useAppStore.getState().createCustomTab('Desk');
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const tabId = () => useAppStore.getState().activeMarketId;
  const layoutKey = () => `ogg.customTabLayout.v1.${tabId()}`;

  it("keeps a closed tab's layout deleted when a save was still pending", () => {
    const id = tabId();
    const key = layoutKey();
    const { unmount } = render(<DockHost layoutId={id} />);
    act(() => dock.fireLayout());

    act(() => useAppStore.getState().closeCustomTab(id));
    unmount();
    vi.advanceTimersByTime(1_000);

    expect(localStorage.getItem(key)).toBeNull();
  });

  it('saves a pending layout when leaving a tab that stays open', () => {
    const key = layoutKey();
    const { unmount } = render(<DockHost layoutId={tabId()} />);
    act(() => dock.fireLayout());

    unmount();

    expect(localStorage.getItem(key)).not.toBeNull();
  });

  it('waits for the layout to settle before serializing', () => {
    const key = layoutKey();
    render(<DockHost layoutId={tabId()} />);
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
    useAppStore.getState().addWidget({ id: 'architect', kind: 'architect' });
    useAppStore.getState().navigateToWidget('architect');

    const first = render(<DockHost layoutId={tabId()} />);
    expect(dock.api.setActive).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().widgetFocusRequest).toBeNull();
    first.unmount();

    render(<DockHost layoutId={tabId()} />);
    expect(dock.api.setActive).toHaveBeenCalledTimes(1);
  });

  it('starts Chain as two positioned panels and preserves membership on resize', () => {
    const id = builtinLayoutId('chain');
    render(<DockHost layoutId={id} />);
    expect(dock.api.panels.map((panel) => panel.id)).toEqual(['chain-table', 'chain-venues']);
    expect(dock.api.addPanel).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'chain-venues',
        position: { referencePanel: 'chain-table', direction: 'left' },
      }),
    );
    const membership = useAppStore.getState().builtinLayouts;
    act(() => {
      dock.fireLayout();
      vi.advanceTimersByTime(300);
    });
    expect(useAppStore.getState().builtinLayouts).toBe(membership);
  });

  it('flushes panel removal to metadata even when leaving before its debounce', () => {
    const id = builtinLayoutId('chain');
    const { unmount } = render(<DockHost layoutId={id} />);
    act(() => dock.api.getPanel('chain-venues')?.api.close());
    unmount();
    expect(readBuiltinLayouts().chain?.map((panel) => panel.id)).toEqual(['chain-table']);
  });

  it.each([
    false,
    true,
  ])('merges saved stats panels while retaining the arrangement (table present: %s)', (hasTable) => {
    const id = builtinLayoutId('chain');
    const grid = {
      root: { type: 'branch', data: [] },
      width: 1200,
      height: 800,
      orientation: 'HORIZONTAL',
    };
    writeLayout(id, {
      grid,
      panels: {
        ...(hasTable
          ? { 'chain-table': { id: 'chain-table', params: { kind: 'chain-table' } } }
          : {}),
        'chain-stats': { id: 'chain-stats', params: { kind: 'chain-stats' } },
        'chain-venues': { id: 'chain-venues', params: { kind: 'chain-venues' } },
      },
    });
    render(<DockHost layoutId={id} />);
    expect(dock.api.clear).not.toHaveBeenCalled();
    expect(dock.api.fromJSON).toHaveBeenCalledWith(expect.objectContaining({ grid }));
    expect(dock.api.panels.map((panel) => panel.id).sort()).toEqual([
      'chain-table',
      'chain-venues',
    ]);
    if (!hasTable) {
      expect(dock.api.addPanel).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'chain-table',
          position: { referencePanel: 'chain-stats', direction: 'within' },
        }),
      );
    }
  });

  it('does not resurrect a saved arrangement when reset interrupts a pending save', () => {
    const id = builtinLayoutId('chain');
    useAppStore.getState().setActiveTab('chain');
    const { unmount } = render(<DockHost layoutId={id} />);
    act(() => dock.fireLayout());
    act(() => useAppStore.getState().resetActiveLayout());
    unmount();
    vi.advanceTimersByTime(1000);
    expect(readLayout(id)).toBeNull();
    expect(readBuiltinLayouts().chain).toBeUndefined();
  });

  it('retains a deliberately empty built-in layout', () => {
    const id = builtinLayoutId('chain');
    render(<DockHost layoutId={id} />);
    act(() => {
      for (const panel of [...dock.api.panels]) panel.api.close();
      vi.advanceTimersByTime(300);
    });
    expect(readBuiltinLayouts().chain).toEqual([]);
  });

  it('hydrates legacy custom-tab panel parameters from validated membership', () => {
    useAppStore.getState().addWidget({ id: 'chain', kind: 'chain' });
    writeLayout(tabId(), {
      grid: {},
      panels: { chain: { id: 'chain', params: { kind: 'chain' } } },
    });
    render(<DockHost layoutId={tabId()} />);
    expect(dock.api.fromJSON).toHaveBeenCalledWith(
      expect.objectContaining({
        panels: { chain: { id: 'chain', params: { id: 'chain', kind: 'chain' } } },
      }),
    );
  });

  it('restores pop-outs only through the script-free workspace host', () => {
    const id = builtinLayoutId('chain');
    writeLayout(id, {
      grid: {},
      panels: { 'chain-table': { id: 'chain-table', params: { kind: 'chain-table' } } },
      popoutGroups: [{ data: { views: ['chain-table'] }, url: '/?popout=1' }],
    });
    render(<DockHost layoutId={id} />);
    expect(dock.api.fromJSON).toHaveBeenCalledWith(
      expect.objectContaining({
        popoutGroups: [expect.objectContaining({ url: '/workspace-popout.html' })],
      }),
    );
  });

  it('reports a pop-up blocked during restoration before the first layout render', () => {
    const id = builtinLayoutId('chain');
    writeLayout(id, {
      grid: {},
      panels: { 'chain-table': { id: 'chain-table', params: { kind: 'chain-table' } } },
      popoutGroups: [{ data: { views: ['chain-table'] } }],
    });
    dock.api.fromJSON.mockImplementation(() => dock.fireFailure());
    render(<DockHost layoutId={id} />);
    expect(screen.getByRole('alert').textContent).toContain('Allow pop-ups');
    expect(dock.api.panels).toHaveLength(2);
  });

  it('places template-backed custom panels in their starting groups', () => {
    useAppStore.getState().createCustomTab('Trade planning', 'planning');
    render(<DockHost layoutId={tabId()} />);
    expect(dock.api.panels.map((panel) => panel.id)).toEqual([
      'chain-table',
      'architect',
      'vol-smile',
    ]);
    expect(dock.api.addPanel).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'architect',
        position: { referencePanel: 'chain-table', direction: 'right' },
      }),
    );
    expect(dock.api.addPanel).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'vol-smile',
        position: { referencePanel: 'chain-table', direction: 'below' },
      }),
    );
  });
});
