import type { ExchangePortfolioTrade, PositionLeg } from '@oggregator/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { ledgerMock, clients, FakeThalexClient } = vi.hoisted(() => {
  type Listener<T> = (value: T) => void;
  class FakeThalexClient {
    positions: Listener<unknown[]> | null = null;
    trades: Listener<unknown[]> | null = null;
    constructor(readonly creds: { env?: string }) {
      clients.push(this);
    }
    subscribe(listener: Listener<unknown[]>) {
      this.positions = listener;
      return () => {};
    }
    subscribeTrades(listener: Listener<unknown[]>) {
      this.trades = listener;
      return () => {};
    }
    async start() {}
    async dispose() {}
    async fetchEquityHistory() {
      return [];
    }
    getLatestMargin() {
      return null;
    }
  }
  const clients: FakeThalexClient[] = [];
  return {
    clients,
    FakeThalexClient,
    ledgerMock: {
      enabled: true,
      loadPositions: vi.fn(async () => [] as unknown[]),
      replacePositions: vi.fn(async () => {}),
      upsertTrades: vi.fn(async () => {}),
      loadTrades: vi.fn(async () => []),
      loadTradeSummary: vi.fn(async () => ({ lastSyncedAtMs: null })),
      dispose: vi.fn(async () => {}),
    },
  };
});

vi.mock('@oggregator/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@oggregator/core')>()),
  ThalexPrivateClient: FakeThalexClient,
}));
vi.mock('./trading-services.js', () => ({ exchangePortfolioLedgerStore: ledgerMock }));
vi.mock('./portfolio-fill-prices.js', () => ({ portfolioFillPriceAt: async () => null }));

import { ledgerMatchesSession, ThalexPositionStore, thalexPositionStore } from './thalex-position-store.js';

function leg(legId: string, size: number): PositionLeg {
  return { legId, size, entryPriceUsd: 100, underlying: 'BTC' } as PositionLeg;
}
const trade = { tradeId: 't1', underlying: 'BTC' } as ExchangePortfolioTrade;
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('ThalexPositionStore environments', () => {
  let store: ThalexPositionStore;

  beforeEach(() => {
    store = new ThalexPositionStore();
    clients.length = 0;
    for (const fn of Object.values(ledgerMock)) if (typeof fn === 'function') fn.mockClear();
  });

  afterEach(async () => {
    await store.dispose();
    await thalexPositionStore.dispose();
  });

  it('keeps a testnet session out of the mainnet ledger entirely', async () => {
    await store.connect({ accountId: 'a1', kid: 'k', privateKeyPem: 'p', env: 'test' });
    clients[0]!.positions!([leg('L1', 1)]);
    clients[0]!.trades!([trade]);
    await flush();

    expect(store.environment('a1')).toBe('test');
    expect(store.list('a1').map((l) => l.legId)).toEqual(['L1']);
    expect(ledgerMock.loadPositions).not.toHaveBeenCalled();
    expect(ledgerMock.replacePositions).not.toHaveBeenCalled();
    expect(ledgerMock.upsertTrades).not.toHaveBeenCalled();
  });

  it('hydrates and persists a mainnet session as before', async () => {
    await store.connect({ accountId: 'a1', kid: 'k', privateKeyPem: 'p' });
    clients[0]!.trades!([trade]);
    await flush();

    expect(store.environment('a1')).toBe('prod');
    expect(ledgerMock.loadPositions).toHaveBeenCalledWith('a1', 'thalex');
    expect(ledgerMock.upsertTrades).toHaveBeenCalledTimes(1);
  });

  it('drops mainnet legs when the account switches to testnet', async () => {
    await store.connect({ accountId: 'a1', kid: 'k', privateKeyPem: 'p', env: 'prod' });
    clients[0]!.positions!([leg('MAIN', 2)]);
    const events: string[][] = [];
    store.subscribe((event) => events.push(event.changedLegIds));

    await store.connect({ accountId: 'a1', kid: 'k2', privateKeyPem: 'p2', env: 'test' });

    expect(store.list('a1')).toEqual([]);
    expect(events).toContainEqual([]);
    expect(store.environment('a1')).toBe('test');
  });

  it('never lets an overlapping testnet connect reach the mainnet ledger', async () => {
    let releaseHydrate: () => void = () => {};
    ledgerMock.loadPositions.mockImplementationOnce(
      () => new Promise<unknown[]>((resolve) => (releaseHydrate = () => resolve([]))),
    );

    const mainnet = store.connect({ accountId: 'a1', kid: 'k', privateKeyPem: 'p', env: 'prod' });
    const testnet = store.connect({ accountId: 'a1', kid: 'k2', privateKeyPem: 'p2', env: 'test' });
    await vi.waitFor(() => expect(ledgerMock.loadPositions).toHaveBeenCalled());
    releaseHydrate();
    await Promise.all([mainnet, testnet]);

    expect(clients).toHaveLength(2);
    expect(store.environment('a1')).toBe('test');
    clients[1]!.positions!([leg('TEST', 1)]);
    clients[0]!.positions!([leg('STALE_MAIN', 1)]);
    clients[1]!.trades!([trade]);
    await flush();

    expect(store.list('a1').map((l) => l.legId)).toEqual(['TEST']);
    expect(ledgerMock.replacePositions).not.toHaveBeenCalled();
    expect(ledgerMock.upsertTrades).not.toHaveBeenCalled();
  });

  it('stops showing testnet legs once the testnet session ends', async () => {
    await store.connect({ accountId: 'a1', kid: 'k', privateKeyPem: 'p', env: 'test' });
    clients[0]!.positions!([leg('TEST', 1)]);
    const events: string[][] = [];
    store.subscribe((event) => events.push(event.changedLegIds));

    await store.disconnect('a1');

    expect(store.list('a1')).toEqual([]);
    expect(events).toContainEqual([]);
  });

  it('reports no environment once disconnected', async () => {
    await store.connect({ accountId: 'a1', kid: 'k', privateKeyPem: 'p', env: 'test' });
    await store.disconnect('a1');
    expect(store.environment('a1')).toBeNull();
  });
});

describe('ledgerMatchesSession', () => {
  afterEach(async () => {
    await thalexPositionStore.dispose();
  });

  it('only hides the ledger for a Thalex account on testnet', async () => {
    expect(ledgerMatchesSession('a1', 'thalex')).toBe(true);
    await thalexPositionStore.connect({ accountId: 'a1', kid: 'k', privateKeyPem: 'p', env: 'test' });
    expect(ledgerMatchesSession('a1', 'thalex')).toBe(false);
    expect(ledgerMatchesSession('a1', 'derive')).toBe(true);
    expect(ledgerMatchesSession('a2', 'thalex')).toBe(true);
  });
});
