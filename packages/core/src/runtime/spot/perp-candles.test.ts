import { describe, expect, it, vi } from 'vitest';
import { PerpCandleRuntime } from './perp-candles.js';

const BAR = 300_000;
const T0 = 1_792_718_400_000;

function okResponse(payload: unknown): Response {
  return { ok: true, status: 200, json: async () => payload } as Response;
}

/** Bybit rows newest first, from `newestStart` back `count` bars, close = bar index. */
function klines(newestStart: number, count: number) {
  const list = Array.from({ length: count }, (_, i) => {
    const start = newestStart - i * BAR;
    return [String(start), '1', '1', '1', String(start / BAR - T0 / BAR + 100), '5', '5'];
  });
  return { retCode: 0, retMsg: 'OK', result: { symbol: 'X', category: 'linear', list } };
}

describe('PerpCandleRuntime', () => {
  it('loads history once, drops the forming bar, then fetches only the missing tail', async () => {
    let now = T0 + 60_000;
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const limit = Number(new URL(String(input)).searchParams.get('limit'));
      return okResponse(klines(Math.floor(now / BAR) * BAR, limit));
    });
    const runtime = new PerpCandleRuntime({ fetchImpl, historyBars: 10, now: () => now });

    const first = await runtime.getCandles(['BTCUSDT']);
    expect(first.lastClosedStart).toBe(T0 - BAR);
    expect(String(fetchImpl.mock.calls[0]![0])).toContain('interval=5&limit=10');
    const bars = first.series.get('BTCUSDT')!;
    expect(bars).toHaveLength(9);
    expect(bars[bars.length - 1]!.start).toBe(T0 - BAR);
    expect(bars[0]!.start).toBeLessThan(bars[1]!.start);

    await runtime.getCandles(['BTCUSDT']);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    now += 2 * BAR;
    const later = await runtime.getCandles(['BTCUSDT']);
    expect(String(fetchImpl.mock.calls[1]![0])).toContain('limit=4');
    const merged = later.series.get('BTCUSDT')!;
    expect(merged).toHaveLength(10);
    expect(merged[merged.length - 1]!.start).toBe(T0 + BAR);
    expect(new Set(merged.map((b) => b.start)).size).toBe(10);
  });

  it('leaves unlisted symbols out and does not retry them for an hour', async () => {
    let now = T0 + 60_000;
    const fetchImpl = vi.fn(async (input: string | URL | Request) =>
      String(input).includes('NOPEUSDT')
        ? okResponse({ retCode: 10001, retMsg: 'params error: Symbol Is Invalid', result: {} })
        : okResponse(klines(Math.floor(now / BAR) * BAR, 5)),
    );
    const runtime = new PerpCandleRuntime({ fetchImpl, historyBars: 5, now: () => now });

    const snap = await runtime.getCandles(['BTCUSDT', 'NOPEUSDT']);
    expect(snap.series.has('NOPEUSDT')).toBe(false);
    expect(snap.series.get('BTCUSDT')).toHaveLength(4);

    now += BAR;
    await runtime.getCandles(['BTCUSDT', 'NOPEUSDT']);
    const nopeCalls = fetchImpl.mock.calls.filter((c) => String(c[0]).includes('NOPEUSDT'));
    expect(nopeCalls).toHaveLength(1);
  });

  it('keeps the held series when a refresh fails', async () => {
    let now = T0 + 60_000;
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(okResponse(klines(T0, 5)))
      .mockResolvedValueOnce({ ok: false, status: 503 } as Response);
    const runtime = new PerpCandleRuntime({ fetchImpl, historyBars: 5, now: () => now });

    await runtime.getCandles(['BTCUSDT']);
    now += BAR;
    const snap = await runtime.getCandles(['BTCUSDT']);
    expect(snap.series.get('BTCUSDT')).toHaveLength(4);
  });
});
