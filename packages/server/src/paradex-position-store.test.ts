import { ParadexPrivateClient } from '@oggregator/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ParadexPositionStore } from './paradex-position-store.js';
import type { ExchangePortfolioLedgerStore, PersistedExchangeTrade } from '@oggregator/db';

const IDLE_MS = 15 * 60_000;

function token(subject: string): string {
  return `h.${Buffer.from(JSON.stringify({ sub: subject, exp: 2_000_000_000 })).toString('base64url')}.s`;
}

function memoryLedger(): ExchangePortfolioLedgerStore {
  let trades: PersistedExchangeTrade[] = [];
  return {
    enabled: true,
    loadPositions: vi.fn(async () => []),
    replacePositions: vi.fn(async () => {}),
    upsertTrades: vi.fn(async (_account, _venue, incoming) => {
      trades = incoming;
    }),
    loadTrades: vi.fn(async () => trades),
    loadTradeSummary: vi.fn(async () => ({
      tradeCount: trades.length,
      grossBuyPremiumUsd: 50,
      grossSellPremiumUsd: 0,
      knownFeesUsd: 0.5,
      realizedPnlUsd: 2,
      historyFromMs: Date.UTC(2026, 10, 17),
      lastSyncedAtMs: Date.now(),
    })),
    dispose: vi.fn(async () => {}),
  };
}

describe('Paradex durable account scope', () => {
  const at = Date.UTC(2026, 10, 17);
  const option = {
    id: 'p',
    market: 'BTC-USD-27NOV26-80000-P',
    status: 'OPEN',
    size: '0.1',
    average_entry_price_usd: '500',
    unrealized_pnl: '5',
    created_at: at,
  };
  const fill = {
    id: 'f',
    market: option.market,
    side: 'BUY',
    size: '0.1',
    price: '500',
    fee: '0.5',
    fee_currency: 'USDC',
    realized_pnl: '2',
    underlying_price: '81000',
    created_at: at,
  };

  it('persists mainnet fills and derives an entry anchor from the venue underlying price', async () => {
    const ledger = memoryLedger();
    const store = new ParadexPositionStore(
      (creds) =>
        new ParadexPrivateClient(
          creds,
          vi
            .fn()
            .mockImplementation((url: string) =>
              Promise.resolve(
                new Response(
                  JSON.stringify(
                    url.includes('/fills?') ? { results: [fill] } : { results: [option] },
                  ),
                ),
              ),
            ),
        ),
      ledger,
    );
    try {
      await store.connect({ accountId: 'alice', readonlyToken: token('0x000abc') });
      await vi.waitFor(() => expect(store.list('alice')[0]?.entryIvSource).toBe('fill'));
      expect(store.list('alice')[0]).toMatchObject({ entryUnderlyingUsd: 81000, entryTs: at });
      expect(ledger.upsertTrades).toHaveBeenCalledWith(
        'alice:paradex:prod:abc',
        'paradex',
        expect.arrayContaining([expect.objectContaining({ tradeId: 'f', feeUsd: 0.5 })]),
        expect.any(Date),
      );
      expect(store.getAccounting('alice')).toMatchObject({
        knownFeesUsd: 0.5,
        realizedPnlUsd: 2,
        persistence: 'venue_history',
      });
      store.recordEntryIvs('alice', new Map([[store.list('alice')[0]!.legId, 0.4]]));
      expect(store.list('alice')[0]?.entryIvSource).toBe('fill');
    } finally {
      await store.dispose();
    }
  });

  it('never reads or writes the mainnet ledger for testnet and removes testnet legs on disconnect', async () => {
    const ledger = memoryLedger();
    const fetchImpl = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ results: [option] }))),
      );
    const store = new ParadexPositionStore(
      (creds) => new ParadexPrivateClient(creds, fetchImpl),
      ledger,
    );
    try {
      await store.connect({ accountId: 'alice', readonlyToken: token('0xabc'), env: 'test' });
      expect(store.environment('alice')).toBe('test');
      expect(store.list('alice')).toHaveLength(1);
      expect(fetchImpl.mock.calls[0]![0]).toMatch(/^https:\/\/api.testnet.paradex.trade\//);
      expect(ledger.loadPositions).not.toHaveBeenCalled();
      expect(ledger.replacePositions).not.toHaveBeenCalled();
      expect(ledger.upsertTrades).not.toHaveBeenCalled();
      await store.disconnect('alice');
      expect(store.list('alice')).toEqual([]);
    } finally {
      await store.dispose();
    }
  });

  it('keeps venue-account histories separate when a token changes accounts', async () => {
    const ledger = memoryLedger();
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
      ledger,
    );
    try {
      await store.connect({ accountId: 'alice', readonlyToken: token('0xabc') });
      expect(store.ledgerAccountId('alice')).toBe('alice:paradex:prod:abc');
      await store.connect({ accountId: 'alice', readonlyToken: token('0xdef') });
      expect(store.ledgerAccountId('alice')).toBe('alice:paradex:prod:def');
      expect(ledger.loadPositions).toHaveBeenCalledWith('alice:paradex:prod:def', 'paradex');
    } finally {
      await store.dispose();
    }
  });
});

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
