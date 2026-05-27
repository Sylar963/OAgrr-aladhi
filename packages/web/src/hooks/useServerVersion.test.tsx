/**
 * @vitest-environment jsdom
 */

import { useAppStore } from '@stores/app-store';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useServerVersion } from './useServerVersion';

beforeEach(() => {
  useAppStore.setState({
    announcement: null,
    feedStatus: {
      connectionState: 'closed',
      failedVenueCount: 0,
      failedVenueIds: [],
      failedVenues: [],
      venueStates: {},
      staleMs: null,
      lastUpdateMs: null,
    },
  });
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
    useAppStore.setState({
      announcement: { id: 'old', severity: 'info', blocking: false, title: 'Old' },
    });
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

  it('writes venue feed health into global feed status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          bootTime: 1,
          feeds: {
            summary: { totalVenues: 2, connectedVenues: 2, lastAnyMessageAgeMs: 25 },
            venues: [
              { venue: 'deribit', connected: true, lastMessageAgeMs: 25 },
              { venue: 'okx', connected: true, lastMessageAgeMs: 40 },
            ],
          },
        }),
      }),
    );

    const { unmount } = renderHook(() => useServerVersion());
    await waitFor(() => {
      expect(useAppStore.getState().feedStatus).toMatchObject({
        connectionState: 'live',
        failedVenueCount: 0,
        failedVenueIds: [],
        staleMs: 25,
        venueStates: { deribit: 'live', okx: 'live' },
      });
    });
    unmount();
  });
});
