import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

const { ledgerMock } = vi.hoisted(() => ({
  ledgerMock: {
    enabled: true as boolean,
    loadTrades: vi.fn(),
  },
}));

vi.mock('../../trading-services.js', () => ({
  exchangePortfolioLedgerStore: ledgerMock,
}));

vi.mock('../../user-service.js', () => ({
  getRequestAccountId: (_req: unknown, fallback: string) => fallback,
}));

import { portfolioTradesRoute } from './trades.js';

function row(overrides: Record<string, unknown>) {
  return {
    tradeId: 't1',
    orderId: null,
    groupId: null,
    instrumentName: 'BTC-20261030-70000-C',
    underlying: 'BTC',
    expiry: '2026-10-30',
    strike: 70_000,
    optionRight: 'call',
    direction: 'buy',
    amount: 1,
    priceUsd: 2_500,
    feeUsd: null,
    realizedPnlUsd: null,
    liquidityRole: 'taker',
    timestampMs: 1_790_000_000_000,
    ...overrides,
  };
}

describe('GET /portfolio/exchange-trades', () => {
  const app = Fastify();

  beforeAll(async () => {
    await app.register(portfolioTradesRoute);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    ledgerMock.enabled = true;
    ledgerMock.loadTrades.mockReset();
  });

  it('returns only trades for the requested instrument, tagged with the venue', async () => {
    ledgerMock.loadTrades.mockResolvedValue([
      row({ tradeId: 'match' }),
      row({ tradeId: 'other-strike', strike: 75_000 }),
      row({ tradeId: 'other-right', optionRight: 'put' }),
      row({ tradeId: 'other-expiry', expiry: '2026-11-27' }),
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/portfolio/exchange-trades?venue=derive&underlying=BTC&expiry=2026-10-30&strike=70000&right=call',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ledgerEnabled).toBe(true);
    expect(body.trades.map((t: { tradeId: string }) => t.tradeId)).toEqual(['match']);
    expect(body.trades[0].venue).toBe('derive');
    expect(ledgerMock.loadTrades).toHaveBeenCalledWith(expect.any(String), 'derive', 5_000);
  });

  it('reports a disabled ledger instead of querying it', async () => {
    ledgerMock.enabled = false;
    const res = await app.inject({ method: 'GET', url: '/portfolio/exchange-trades?venue=thalex' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ venue: 'thalex', ledgerEnabled: false, trades: [] });
    expect(ledgerMock.loadTrades).not.toHaveBeenCalled();
  });

  it('rejects venues without a private trade ledger', async () => {
    const res = await app.inject({ method: 'GET', url: '/portfolio/exchange-trades?venue=deribit' });
    expect(res.statusCode).toBe(400);
  });
});
