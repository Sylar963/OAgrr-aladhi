import type { ExchangePortfolioTrade, PositionLeg } from '@oggregator/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { ledgerMock, clients, FakeThalexClient } = vi.hoisted(() => {
  type Listener<T> = (value: T) => void;
  class FakeThalexClient {
    positions: ((legs: unknown[], linear?: unknown[]) => void) | null = null;
    trades: Listener<unknown[]> | null = null;
    settlements: (() => void) | null = null;
    realizedPnl: number | null = null;
    constructor(readonly creds: { env?: string }) {
      clients.push(this);
    }
    subscribe(listener: (legs: unknown[], linear: unknown[]) => void) {
      this.positions = (legs, linear = []) => listener(legs, linear);
      return () => {};
    }
    subscribeTrades(listener: Listener<unknown[]>) {
      this.trades = listener;
      return () => {};
    }
    subscribeSettlements(listener: () => void) {
      this.settlements = listener;
      return () => {};
    }
    getRealizedPnl() {
      return this.realizedPnl;
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

  it('keeps perps beside the option legs and broadcasts when they change', async () => {
    await store.connect({ accountId: 'a1', kid: 'k', privateKeyPem: 'p', env: 'test' });
    const events: string[][] = [];
    store.subscribe((event) => events.push(event.changedLegIds));
    const perp = {
      instrumentName: 'BTC-PERPETUAL',
      underlying: 'BTC',
      kind: 'perpetual',
      expiry: null,
      sizeCoin: 0.02,
      entryPriceUsd: 81_200,
      markPriceUsd: 81_450,
      source: 'thalex',
    };
    clients[0]!.positions!([leg('L1', 1)], [perp]);
    expect(store.listLinear('a1')).toEqual([perp]);
    const afterFirst = events.length;
    clients[0]!.positions!([leg('L1', 1)], [perp]);
    expect(events).toHaveLength(afterFirst);
    clients[0]!.positions!([leg('L1', 1)], []);
    expect(store.listLinear('a1')).toEqual([]);
    expect(events).toHaveLength(afterFirst + 1);
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

  it('offers only a live mainnet session key to the order-book login', async () => {
    const changes = vi.fn();
    store.subscribeMainnetKeys(changes);

    await store.connect({ accountId: 't1', kid: 'kt', privateKeyPem: 'pt', env: 'test' });
    expect(store.mainnetBookAuth()).toBeNull();

    await store.connect({ accountId: 'a1', kid: 'k1', privateKeyPem: 'p1', account: 'ACC' });
    expect(store.mainnetBookAuth()).toEqual({ kid: 'k1', privateKeyPem: 'p1', account: 'ACC' });
    expect(changes).toHaveBeenCalledTimes(1);

    await store.disconnect('a1');
    expect(store.mainnetBookAuth()).toBeNull();
    expect(changes).toHaveBeenCalledTimes(2);
  });

  it('reports no environment once disconnected', async () => {
    await store.connect({ accountId: 'a1', kid: 'k', privateKeyPem: 'p', env: 'test' });
    await store.disconnect('a1');
    expect(store.environment('a1')).toBeNull();
  });

  it('reports the client\'s daily-mark realised P&L over the fill ledger sum once it has loaded', async () => {
    await store.connect({ accountId: 'a1', kid: 'k', privateKeyPem: 'p' });
    const listener = vi.fn();
    store.subscribe(listener);

    expect(store.getAccounting('a1').realizedPnlUsd).toBe(0);

    clients[0]!.realizedPnl = -15;
    clients[0]!.settlements!();

    expect(store.getAccounting('a1').realizedPnlUsd).toBe(-15);
    expect(listener).toHaveBeenCalledWith({ accountId: 'a1', changedLegIds: [] });
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
