import { fetchSpots } from './api';

beforeEach(() => {
  process.env.LANDING_API_BASE_URL = 'https://api.example.test';
});

afterEach(() => {
  delete process.env.LANDING_API_BASE_URL;
  vi.unstubAllGlobals();
});

describe('fetchSpots', () => {
  it('returns parsed spot items and strips unknown fields', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              items: [{ symbol: 'BTCUSDT', lastPrice: 81300, change24hPct: 0.025, updatedAt: 1 }],
            }),
            { status: 200 },
          ),
      ),
    );

    const items = await fetchSpots();

    expect(items).toEqual([{ symbol: 'BTCUSDT', lastPrice: 81300, change24hPct: 0.025 }]);
  });

  it('returns null when the API base is unset', async () => {
    delete process.env.LANDING_API_BASE_URL;
    expect(await fetchSpots()).toBeNull();
  });

  it('returns null on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('err', { status: 502 })),
    );
    expect(await fetchSpots()).toBeNull();
  });
});
