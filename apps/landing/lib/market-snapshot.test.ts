import { getMarketSnapshot } from './market-snapshot';

beforeEach(() => {
  process.env.LANDING_API_BASE_URL = 'https://api.example.test';
});

afterEach(() => {
  delete process.env.LANDING_API_BASE_URL;
  vi.unstubAllGlobals();
});

describe('getMarketSnapshot', () => {
  it('maps live BTC/ETH spot to formatted labels and ignores other symbols', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              items: [
                { symbol: 'BTCUSDT', lastPrice: 81300, change24hPct: 0.025 },
                { symbol: 'ETHUSDT', lastPrice: 2100, change24hPct: -0.012 },
                { symbol: 'SOLUSDT', lastPrice: 150, change24hPct: 0.05 },
              ],
            }),
            { status: 200 },
          ),
      ),
    );

    const snapshot = await getMarketSnapshot();

    expect(snapshot.spots.BTC).toEqual({ priceLabel: '$81.3K', changeLabel: '+2.5%' });
    expect(snapshot.spots.ETH).toEqual({ priceLabel: '$2.1K', changeLabel: '-1.2%' });
    expect(Object.keys(snapshot.spots)).toHaveLength(2);
  });

  it('returns empty spots when the API is unavailable', async () => {
    delete process.env.LANDING_API_BASE_URL;
    const snapshot = await getMarketSnapshot();
    expect(snapshot.spots).toEqual({});
  });
});
