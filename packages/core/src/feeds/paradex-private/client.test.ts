import { afterEach, describe, expect, it, vi } from 'vitest';

import { ParadexAuthError, ParadexPrivateClient } from './client.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
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
    expect(client.getLatestLegs()[0]).toMatchObject({ underlying: 'ETH', size: 2, venueMarkPriceUsd: 160 });
    await client.dispose();
  });

  it('fails start when Paradex rejects the token', async () => {
    const client = new ParadexPrivateClient(
      { readonlyToken: 'bad' },
      vi.fn().mockResolvedValue(jsonResponse(401, { error: 'INVALID_TOKEN' })),
    );
    await expect(client.start()).rejects.toBeInstanceOf(ParadexAuthError);
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
