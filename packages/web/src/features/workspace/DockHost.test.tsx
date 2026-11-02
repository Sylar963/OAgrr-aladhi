import { act, cleanup, render, screen } from '@testing-library/react';
import type { IDockviewPanelProps } from 'dockview-react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WidgetPanel } from './DockHost';

const lifecycle = { mounts: 0, unmounts: 0 };

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
