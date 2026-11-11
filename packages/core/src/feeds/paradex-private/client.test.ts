import { afterEach, describe, expect, it, vi } from 'vitest';

import { ParadexAuthError, ParadexPrivateClient } from './client.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const option = {
  id: '1',
  market: 'ETH-USD-27NOV26-4000-P',
  status: 'OPEN',
  size: '2',
  average_entry_price_usd: '150',
  unrealized_pnl: '20',
};

describe('ParadexPrivateClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('sends the token as a bearer and publishes option legs', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { results: [option] }));
    const client = new ParadexPrivateClient({ readonlyToken: 'tok' }, fetchImpl);
    const seen: number[] = [];
    client.subscribe((legs) => seen.push(legs.length));

    await client.start();

    expect(fetchImpl.mock.calls[0]![1].headers).toEqual({ Authorization: 'Bearer tok' });
    expect(seen).toEqual([1]);
    expect(client.getLatestLegs()[0]).toMatchObject({
      underlying: 'ETH',
      size: 2,
      venueMarkPriceUsd: 160,
    });
    await client.dispose();
  });

  it('fails start when Paradex rejects the token', async () => {
    const client = new ParadexPrivateClient(
      { readonlyToken: 'bad' },
      vi.fn().mockResolvedValue(jsonResponse(401, { error: 'INVALID_TOKEN' })),
    );
    await expect(client.start()).rejects.toBeInstanceOf(ParadexAuthError);
  });

  it('requests the required history resolution and keeps only the requested window', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        data: [1000, 1100],
        timestamps: [1_790_000_000_000, 1_791_000_000_000],
      }),
    );
    const client = new ParadexPrivateClient({ readonlyToken: 'tok' }, fetchImpl);
    expect(await client.fetchEquityHistory(1_790_500_000_000)).toEqual([
      { ts: 1_791_000_000_000, equityUsd: 1100 },
    ]);
    const url = new URL(fetchImpl.mock.calls[0]![0]);
    expect(url.searchParams.get('type')).toBe('value');
    expect(url.searchParams.get('resolution')).toBe('alltime');
    expect(fetchImpl.mock.calls[0]![1].signal).toBeInstanceOf(AbortSignal);
    await client.dispose();
  });

  it('reads venue cumulative P&L separately from equity and preserves losses', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, {
      data: [0, -18.72], timestamps: [1_790_000_000_000, 1_791_000_000_000],
    }));
    const client = new ParadexPrivateClient({ readonlyToken: 'tok' }, fetchImpl);
    expect(await client.fetchPnlHistory(1_790_500_000_000)).toEqual([
      { ts: 1_791_000_000_000, pnlUsd: -18.72 },
    ]);
    const url = new URL(fetchImpl.mock.calls[0]![0]);
    expect(url.searchParams.get('type')).toBe('pnl');
    expect(url.searchParams.get('resolution')).toBe('alltime');
    await client.dispose();
  });

  it('recovers polling after a hung positions request times out', async () => {
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), ms);
      return controller.signal;
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { results: [] }))
      .mockImplementationOnce(
        (_url: string, options: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            options.signal!.addEventListener('abort', () => reject(options.signal!.reason), {
              once: true,
            });
          }),
      )
      .mockResolvedValue(jsonResponse(200, { results: [option] }));
    const client = new ParadexPrivateClient({ readonlyToken: 'tok' }, fetchImpl);
    await client.start();
    await vi.advanceTimersByTimeAsync(25_000);
    expect(client.getLatestLegs()).toEqual([]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(client.getLatestLegs()).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    await client.dispose();
  });

  it('does not restart polling when disposed during the initial positions read', async () => {
    vi.useFakeTimers();
    let resolve!: (response: Response) => void;
    const fetchImpl = vi.fn().mockImplementation(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    const client = new ParadexPrivateClient({ readonlyToken: 'tok' }, fetchImpl);
    const listener = vi.fn();
    client.subscribe(listener);
    const starting = client.start();
    await client.dispose();
    resolve(jsonResponse(200, { results: [option] }));
    await starting;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]![1].signal.aborted).toBe(true);
    expect(listener).not.toHaveBeenCalled();
    expect(client.getLatestLegs()).toEqual([]);
  });

  it('stops polling once the token is revoked', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { results: [] }))
      .mockResolvedValue(jsonResponse(401, {}));
    const client = new ParadexPrivateClient({ readonlyToken: 'tok' }, fetchImpl);
    await client.start();

    await vi.advanceTimersByTimeAsync(15_000);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await client.dispose();
  });
});

const rfq = {
  id: 'r_test',
  state: 'OPEN',
  quantity: '2',
  filled_quantity: '0',
  created_at: 1,
  expires_at: 9_999_999_999_999,
  legs: [{ market: 'BTC-USD-27NOV26-80000-C', side: 'BUY', ratio: '1' }],
};

describe('Paradex account and RFQ reads', () => {
  it('reads current equity including P&L, not total collateral or historical closes', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        account: '0x123456789abcdef',
        account_value: '136285.06918911',
        free_collateral: '73276.47229774',
        initial_margin_requirement: '63008.59689218',
        maintenance_margin_requirement: '31597.25239676',
        total_collateral: '123003.62047353',
        settlement_asset: 'USDC',
        updated_at: 1681471234972,
      }),
    );
    const client = new ParadexPrivateClient({ readonlyToken: 'tok' }, fetchImpl);
    expect(await client.fetchAccountSummary()).toMatchObject({
      venueAccount: '0x123456789abcdef',
      equityUsd: 136285.06918911,
      freeCollateralUsd: 73276.47229774,
      initialMarginUsd: 63008.59689218,
      maintenanceMarginUsd: 31597.25239676,
      settlementAsset: 'USDC',
      updatedAt: 1681471234972,
    });
    expect(fetchImpl.mock.calls[0]![0]).toMatch(/\/account$/);
    expect(fetchImpl.mock.calls[0]![1].headers).toEqual({ Authorization: 'Bearer tok' });
  });

  it('preserves zero equity, negative free collateral and absent margin fields', async () => {
    const client = new ParadexPrivateClient(
      { readonlyToken: 'tok' },
      vi.fn().mockResolvedValue(jsonResponse(200, { account_value: '0', free_collateral: '-10' })),
    );
    expect(await client.fetchAccountSummary()).toMatchObject({
      equityUsd: 0,
      freeCollateralUsd: -10,
      initialMarginUsd: null,
    });
  });

  it.each([
    '',
    'NaN',
    'Infinity',
    '1e999',
  ])('rejects invalid account equity %s', async (account_value) => {
    const client = new ParadexPrivateClient(
      { readonlyToken: 'tok' },
      vi.fn().mockResolvedValue(jsonResponse(200, { account_value })),
    );
    await expect(client.fetchAccountSummary()).rejects.toThrow();
  });

  it('keeps a cursor on an empty registration page and encodes it on the next read', async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(() => Promise.resolve(jsonResponse(200, { results: [], next: 'a+=/b' })));
    const client = new ParadexPrivateClient({ readonlyToken: 'tok' }, fetchImpl);
    expect(await client.fetchOpenRfqs('BTC')).toMatchObject({ rfqs: [], next: 'a+=/b' });
    await client.fetchOpenRfqs('BTC', 'a+=/b');
    const url = new URL(fetchImpl.mock.calls[1]![0]);
    expect(url.searchParams.get('cursor')).toBe('a+=/b');
    expect(url.searchParams.get('state')).toBe('OPEN');
  });

  it('reads strategy BBOs only for the selected underlying and keeps signed and zero prices', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          results: [
            rfq,
            { ...rfq, id: 'other', legs: [{ ...rfq.legs[0], market: 'ETH-USD-PERP' }] },
          ],
          next: null,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          rfq_id: rfq.id,
          best_bid_price: '-10',
          best_ask_price: '0',
          best_bid_quantity: '1',
          best_ask_quantity: '2',
          mark_price: '5',
        }),
      );
    const client = new ParadexPrivateClient({ readonlyToken: 'tok' }, fetchImpl);
    const page = await client.fetchOpenRfqs('BTC');
    expect(page.rfqs).toHaveLength(1);
    expect(page.rfqs[0]).toMatchObject({
      quantity: 2,
      filledQuantity: 0,
      quote: { bidPrice: -10, askPrice: 0, bidQuantity: 1, askQuantity: 2 },
    });
    expect(fetchImpl.mock.calls[1]![0]).toMatch(/\/rfqs\/r_test\/bbo$/);
    expect(fetchImpl.mock.calls.every((call) => call[1].method == null)).toBe(true);
  });

  it('does not replace a missing quote with a mark', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { results: [{ ...rfq, mark_price: '999' }] }))
      .mockResolvedValueOnce(jsonResponse(404, {}));
    const page = await new ParadexPrivateClient({ readonlyToken: 'tok' }, fetchImpl).fetchOpenRfqs(
      'BTC',
    );
    expect(page.rfqs[0]!.quote).toBeNull();
  });

  it('rejects unauthorized BBO reads instead of claiming there is no liquidity', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { results: [rfq] }))
      .mockResolvedValueOnce(jsonResponse(403, {}));
    await expect(
      new ParadexPrivateClient({ readonlyToken: 'tok' }, fetchImpl).fetchOpenRfqs('BTC'),
    ).rejects.toBeInstanceOf(ParadexAuthError);
  });

  it('keeps an expired RFQ without reading its BBO', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { results: [{ ...rfq, expires_at: 1 }] }));
    const page = await new ParadexPrivateClient({ readonlyToken: 'tok' }, fetchImpl).fetchOpenRfqs(
      'BTC',
    );
    expect(page.rfqs[0]!.quote).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

it('keeps a one-sided RFQ when the absent bid is an empty string', async () => {
  const fetchImpl = vi
    .fn()
    .mockResolvedValueOnce(jsonResponse(200, { results: [rfq] }))
    .mockResolvedValueOnce(
      jsonResponse(200, {
        best_bid_price: '',
        best_bid_quantity: '',
        best_ask_price: '10',
        best_ask_quantity: '1',
      }),
    );
  const page = await new ParadexPrivateClient({ readonlyToken: 'tok' }, fetchImpl).fetchOpenRfqs(
    'BTC',
  );
  expect(page.rfqs[0]!.quote).toMatchObject({
    bidPrice: null,
    bidQuantity: null,
    askPrice: 10,
    askQuantity: 1,
  });
});
