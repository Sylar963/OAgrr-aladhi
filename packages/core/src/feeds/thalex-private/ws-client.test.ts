import { afterEach, describe, expect, it, vi } from 'vitest';

const thalexWsMockState = vi.hoisted(() => ({
  sentPayloads: [] as Array<{ id: number; method: string; params: Record<string, unknown> }>,
  onMessage: null as ((raw: Buffer) => void) | null,
  loginResult: { account_number: 'main' },
  subscribeResult: ['account.portfolio', 'account.summary', 'account.trade_history'],
  portfolioResult: [
    {
      instrument_name: 'BTC-21APR26-75000-C',
      position: 2,
      average_price: 1850.5,
      mark_price: 1900,
    },
  ] as Array<Record<string, unknown>>,
  tradeHistoryResult: { trades: [] as Array<Record<string, unknown>> },
  dailyMarksResult: { daily_marks: [] as Array<Record<string, unknown>>, bookmark: null },
}));

const ACCOUNT_SUMMARY = vi.hoisted(() => ({
  cash: [
    {
      currency: 'USDT',
      balance: 1000000004483.9625,
      collateral_factor: 1,
      collateral_index_price: null,
      transactable: true,
    },
  ],
  unrealised_pnl: 491.00977310002116,
  session_realised_pnl: 0,
  cash_collateral: 1000000004483.9625,
  margin: 1000000004994.1586,
  required_margin: 13123.880458333333,
  remaining_margin: 999999991870.2781,
}));

const mintAuthTokenMock = vi.hoisted(() => vi.fn(() => 'jwt-token'));

vi.mock('./auth.js', () => ({
  mintAuthToken: mintAuthTokenMock,
}));

vi.mock('../shared/topic-ws-client.js', () => ({
  TopicWsClient: class {
    public isConnected = false;

    constructor(
      private readonly _url: string,
      private readonly _label: string,
      private readonly options: {
        onStatusChange?: (state: 'connected' | 'reconnecting' | 'down') => void;
        onMessage?: (raw: Buffer) => void;
      },
    ) {
      thalexWsMockState.onMessage = options.onMessage ?? null;
    }

    async connect(): Promise<void> {
      this.isConnected = true;
      this.options.onStatusChange?.('connected');
    }

    async disconnect(): Promise<void> {
      this.isConnected = false;
    }

    send(payload: string | Record<string, unknown>): void {
      const msg = typeof payload === 'string' ? JSON.parse(payload) : payload;
      if (msg == null || typeof msg !== 'object') return;

      const id = typeof msg.id === 'number' ? msg.id : 0;
      const method = typeof msg.method === 'string' ? msg.method : '';
      const params =
        msg.params != null && typeof msg.params === 'object'
          ? (msg.params as Record<string, unknown>)
          : {};
      thalexWsMockState.sentPayloads.push({ id, method, params });

      const result =
        method === 'public/login'
          ? thalexWsMockState.loginResult
          : method === 'private/subscribe'
            ? thalexWsMockState.subscribeResult
            : method === 'private/portfolio'
              ? thalexWsMockState.portfolioResult
              : method === 'private/trade_history'
                ? thalexWsMockState.tradeHistoryResult
                : method === 'private/account_summary'
                  ? ACCOUNT_SUMMARY
                  : method === 'private/daily_mark_history'
                    ? thalexWsMockState.dailyMarksResult
                    : null;

      this.options.onMessage?.(Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, result })));
    }
  },
}));

import { ThalexPrivateClient } from './ws-client.js';

afterEach(() => {
  vi.restoreAllMocks();
  mintAuthTokenMock.mockClear();
  thalexWsMockState.sentPayloads.length = 0;
  thalexWsMockState.loginResult = { account_number: 'main' };
  thalexWsMockState.subscribeResult = ['account.portfolio', 'account.summary', 'account.trade_history'];
  thalexWsMockState.portfolioResult = [
    {
      instrument_name: 'BTC-21APR26-75000-C',
      position: 2,
      average_price: 1850.5,
      mark_price: 1900,
    },
  ];
  thalexWsMockState.tradeHistoryResult = { trades: [] };
  thalexWsMockState.dailyMarksResult = { daily_marks: [], bookmark: null };
});

describe('ThalexPrivateClient', () => {
  it('bootstraps positions from private/portfolio after login and subscribe', async () => {
    const client = new ThalexPrivateClient({
      kid: 'kid-1',
      privateKeyPem: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----',
      account: 'main',
    });
    const listener = vi.fn();

    client.subscribe(listener);

    await client.start();

    expect(mintAuthTokenMock).toHaveBeenCalledWith({
      kid: 'kid-1',
      privateKeyPem: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----',
    });
    expect(thalexWsMockState.sentPayloads.map((payload) => payload.method)).toEqual([
      'public/login',
      'private/subscribe',
      'private/portfolio',
      'private/trade_history',
      'private/account_summary',
      'private/daily_mark_history',
    ]);
    expect(listener).toHaveBeenCalledWith([
      expect.objectContaining({
        legId: 'thalex|BTC|2026-04-21|75000|call',
        underlying: 'BTC',
        expiry: '2026-04-21',
        strike: 75000,
        optionRight: 'call',
        size: 2,
        entryPriceUsd: 1850.5,
        source: 'thalex',
      }),
    ], []);
    expect(client.getLatestLegs()).toEqual([
      expect.objectContaining({
        legId: 'thalex|BTC|2026-04-21|75000|call',
        size: 2,
        entryPriceUsd: 1850.5,
      }),
    ]);
  });

  it('tracks initial margin from the bootstrap summary and account.summary notifications', async () => {
    const client = new ThalexPrivateClient({
      kid: 'kid-1',
      privateKeyPem: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----',
    });

    await client.start();

    expect(client.getLatestMargin()).toEqual({
      initialMarginUsd: 13123.880458333333,
      marginUsd: 1000000004994.1586,
      remainingMarginUsd: 999999991870.2781,
      updatedAt: expect.any(Number),
    });

    thalexWsMockState.onMessage?.(
      Buffer.from(
        JSON.stringify({
          channel_name: 'account.summary',
          notification: { ...ACCOUNT_SUMMARY, margin: 20_000, required_margin: 15_000, remaining_margin: 5_000 },
        }),
      ),
    );

    expect(client.getLatestMargin()).toMatchObject({
      initialMarginUsd: 15_000,
      marginUsd: 20_000,
      remainingMarginUsd: 5_000,
    });
  });

  it('reports realised P&L from the daily marks, this session\'s closes and open legs\' settled part', async () => {
    const settledAt = Date.UTC(2026, 9, 21, 8);
    thalexWsMockState.portfolioResult = [
      {
        instrument_name: 'BTC-21APR26-75000-C',
        position: 2,
        average_price: 1_000,
        start_price: 1_150,
        mark_price: 1_200,
      },
    ];
    thalexWsMockState.dailyMarksResult = {
      daily_marks: [
        { time: settledAt / 1000, instrument_name: 'BTC-21APR26-75000-C', position: 2, mark_price: 1_150, realized_position_pnl: 300 },
        { time: settledAt / 1000, instrument_name: 'ETH-21APR26-3000-P', position: 0, mark_price: 50, realized_position_pnl: -40 },
        { time: settledAt / 1000, instrument_name: 'BTC-PERPETUAL', position: 1, mark_price: 100_000, realized_position_pnl: 999 },
      ],
      bookmark: null,
    };
    thalexWsMockState.tradeHistoryResult = {
      trades: [
        { trade_id: 'before', instrument_name: 'BTC-21APR26-80000-C', direction: 'sell', price: 500, amount: 1, time: settledAt / 1000 - 60, position_pnl: 70 },
        { trade_id: 'after', instrument_name: 'BTC-21APR26-80000-C', direction: 'sell', price: 600, amount: 1, time: settledAt / 1000 + 60, position_pnl: 25 },
      ],
    };
    const client = new ThalexPrivateClient({
      kid: 'kid-1',
      privateKeyPem: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----',
    });

    expect(client.getRealizedPnl()).toBeNull();
    await client.start();

    expect(client.getRealizedPnl()).toBe(300 - 40 + 25 + (1_000 - 1_150) * 2);
    expect(client.getRealizedPnl('BTC')).toBe(300 + 25 + (1_000 - 1_150) * 2);
    expect(client.getRealizedPnl('ETH')).toBe(-40);
    await client.dispose();
  });
});
