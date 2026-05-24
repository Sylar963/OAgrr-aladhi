/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

import { useAppStore } from '@stores/app-store';
import { useServerVersion } from './useServerVersion';

beforeEach(() => {
  useAppStore.setState({ announcement: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useServerVersion', () => {
  it('writes the announcement from /health into the store', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          bootTime: 1,
          announcement: { id: 'm1', severity: 'info', title: 'Hi' },
        }),
      }),
    );

    const { unmount } = renderHook(() => useServerVersion());
    await waitFor(() => {
      expect(useAppStore.getState().announcement).toMatchObject({ id: 'm1', severity: 'info' });
    });
    unmount();
  });

  it('clears the announcement when /health has none', async () => {
    useAppStore.setState({ announcement: { id: 'old', severity: 'info', blocking: false, title: 'Old' } });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ bootTime: 1 }) }),
    );

    const { unmount } = renderHook(() => useServerVersion());
    await waitFor(() => {
      expect(useAppStore.getState().announcement).toBeNull();
    });
    unmount();
  });
});
