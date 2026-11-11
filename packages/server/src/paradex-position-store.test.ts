import { ParadexPrivateClient } from '@oggregator/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ParadexPositionStore } from './paradex-position-store.js';

const IDLE_MS = 15 * 60_000;

describe('Paradex connection leases', () => {
  afterEach(() => vi.useRealTimers());

  it('preserves active readers while reconnecting and disconnects after their release', async () => {
    vi.useFakeTimers();
    const store = new ParadexPositionStore(
      (creds) =>
        new ParadexPrivateClient(
          creds,
          vi
            .fn()
            .mockImplementation(() =>
              Promise.resolve(new Response(JSON.stringify({ results: [] }))),
            ),
        ),
    );
    try {
      store.retain('alice');
      await store.connect({ accountId: 'alice', readonlyToken: 'tok' });
      await vi.advanceTimersByTimeAsync(IDLE_MS + 1);
      expect(store.isConnected('alice')).toBe(true);
      await store.connect({ accountId: 'alice', readonlyToken: 'replacement' });
      await vi.advanceTimersByTimeAsync(IDLE_MS + 1);
      expect(store.isConnected('alice')).toBe(true);
      store.release('alice');
      await vi.advanceTimersByTimeAsync(IDLE_MS + 1);
      expect(store.isConnected('alice')).toBe(false);
    } finally {
      await store.dispose();
    }
  });
  it('respects a reader closing while the old client is being disposed', async () => {
    vi.useFakeTimers();
    const clients: ParadexPrivateClient[] = [];
    const store = new ParadexPositionStore((creds) => {
      const client = new ParadexPrivateClient(
        creds,
        vi
          .fn()
          .mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ results: [] })))),
      );
      clients.push(client);
      return client;
    });
    try {
      store.retain('alice');
      await store.connect({ accountId: 'alice', readonlyToken: 'tok' });
      let finishDispose!: () => void;
      const pending = new Promise<void>((resolve) => {
        finishDispose = resolve;
      });
      const dispose = clients[0]!.dispose.bind(clients[0]);
      vi.spyOn(clients[0]!, 'dispose').mockImplementation(async () => {
        await dispose();
        await pending;
      });
      const reconnecting = store.connect({ accountId: 'alice', readonlyToken: 'replacement' });
      store.release('alice');
      finishDispose();
      await reconnecting;
      await vi.advanceTimersByTimeAsync(IDLE_MS + 1);
      expect(store.isConnected('alice')).toBe(false);
    } finally {
      await store.dispose();
    }
  });
});
