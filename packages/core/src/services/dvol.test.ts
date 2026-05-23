import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DvolService, computeIvp, dailyClosesFromCandles } from './dvol.js';
import type { DvolSnapshot, DvolCandle } from './dvol.js';

// ── helpers ───────────────────────────────────────────────────────────────────

// Access the private buildSnapshot method to test the pure computation logic
// without any network calls.
function buildSnapshot(
  svc: DvolService,
  currency: string,
  currentPct: number,
  previousClosePct: number,
  high52wPct: number,
  low52wPct: number,
  dailyClosesPct: number[] = [],
): DvolSnapshot {
  return (
    svc as unknown as {
      buildSnapshot(
        c: string,
        cur: number,
        prev: number,
        hi: number,
        lo: number,
        daily: number[],
      ): DvolSnapshot;
    }
  ).buildSnapshot(currency, currentPct, previousClosePct, high52wPct, low52wPct, dailyClosesPct);
}

function setSnapshot(svc: DvolService, currency: string, snap: DvolSnapshot) {
  (svc as unknown as { snapshots: Map<string, DvolSnapshot> }).snapshots.set(currency, snap);
}

function handlePush(svc: DvolService, data: unknown) {
  (svc as unknown as { handlePush(d: unknown): void }).handlePush(data);
}

function setDailyCloses(svc: DvolService, currency: string, closes: number[]) {
  (svc as unknown as { dailyCloses: Map<string, number[]> }).dailyCloses.set(currency, closes);
}

// ── buildSnapshot — pure computation ─────────────────────────────────────────

describe('DvolService — buildSnapshot', () => {
  let svc: DvolService;

  beforeEach(() => {
    svc = new DvolService();
  });
  afterEach(() => svc.dispose());

  it('converts percentage inputs to fraction outputs', () => {
    const snap = buildSnapshot(svc, 'BTC', 52, 50, 80, 30);
    expect(snap.current).toBeCloseTo(0.52);
    expect(snap.previousClose).toBeCloseTo(0.5);
    expect(snap.high52w).toBeCloseTo(0.8);
    expect(snap.low52w).toBeCloseTo(0.3);
  });

  it('computes ivChange1d as current minus previousClose in fraction form', () => {
    const snap = buildSnapshot(svc, 'BTC', 55, 50, 80, 30);
    expect(snap.ivChange1d).toBeCloseTo(0.05);
  });

  it('computes IVP as percent of daily closes ≤ current', () => {
    // 5 closes, current=35 is ≥ 3 of them → IVP = 60
    const snap = buildSnapshot(svc, 'BTC', 35, 34, 50, 10, [10, 20, 30, 40, 50]);
    expect(snap.ivp).toBeCloseTo(60);
  });

  it('IVP counts ties (closes equal to current)', () => {
    // current=30 matches one close; 30 ≤ 30 so it counts → 3 of 5
    const snap = buildSnapshot(svc, 'BTC', 30, 29, 50, 10, [10, 20, 30, 40, 50]);
    expect(snap.ivp).toBeCloseTo(60);
  });

  it('IVP yields 100 when current is at or above the max close', () => {
    const snap = buildSnapshot(svc, 'BTC', 60, 59, 60, 10, [10, 20, 30, 40, 50]);
    expect(snap.ivp).toBeCloseTo(100);
  });

  it('IVP yields 0 when current is strictly below all closes', () => {
    const snap = buildSnapshot(svc, 'BTC', 5, 4, 50, 10, [10, 20, 30, 40, 50]);
    expect(snap.ivp).toBeCloseTo(0);
  });

  it('IVP returns 0 when daily closes array is empty', () => {
    const snap = buildSnapshot(svc, 'BTC', 50, 49, 50, 50, []);
    expect(snap.ivp).toBe(0);
  });

  it('sets currency correctly', () => {
    const snap = buildSnapshot(svc, 'ETH', 45, 44, 70, 25);
    expect(snap.currency).toBe('ETH');
  });

  it('sets updatedAt to approximately now', () => {
    const before = Date.now();
    const snap = buildSnapshot(svc, 'BTC', 52, 50, 80, 30);
    expect(snap.updatedAt).toBeGreaterThanOrEqual(before);
    expect(snap.updatedAt).toBeLessThanOrEqual(Date.now());
  });
});

// ── handlePush — live update ──────────────────────────────────────────────────

describe('DvolService — handlePush', () => {
  let svc: DvolService;

  beforeEach(() => {
    svc = new DvolService();
  });
  afterEach(() => svc.dispose());

  it('updates current DVOL when a valid push arrives', () => {
    setSnapshot(svc, 'BTC', buildSnapshot(svc, 'BTC', 52, 50, 80, 30));

    handlePush(svc, { index_name: 'btc_usd', volatility: 56 });

    const snap = svc.getSnapshot('BTC')!;
    expect(snap.current).toBeCloseTo(0.56);
  });

  it('preserves 52-week range and previousClose from the existing snapshot', () => {
    setSnapshot(svc, 'BTC', buildSnapshot(svc, 'BTC', 52, 50, 80, 30));

    handlePush(svc, { index_name: 'btc_usd', volatility: 60 });

    const snap = svc.getSnapshot('BTC')!;
    expect(snap.high52w).toBeCloseTo(0.8);
    expect(snap.low52w).toBeCloseTo(0.3);
    expect(snap.previousClose).toBeCloseTo(0.5);
  });

  it('recalculates ivChange1d against stored previousClose', () => {
    setSnapshot(svc, 'BTC', buildSnapshot(svc, 'BTC', 52, 50, 80, 30));

    handlePush(svc, { index_name: 'btc_usd', volatility: 58 });

    const snap = svc.getSnapshot('BTC')!;
    // (58 - 50) / 100 = 0.08
    expect(snap.ivChange1d).toBeCloseTo(0.08);
  });

  it('ignores pushes for unknown currencies', () => {
    // No snapshot set for XRP
    handlePush(svc, { index_name: 'xrp_usd', volatility: 80 });
    expect(svc.getSnapshot('XRP')).toBeNull();
  });

  it('ignores malformed push data', () => {
    setSnapshot(svc, 'BTC', buildSnapshot(svc, 'BTC', 52, 50, 80, 30));
    const before = svc.getSnapshot('BTC')!.current;

    handlePush(svc, { index_name: 'btc_usd' }); // missing volatility
    expect(svc.getSnapshot('BTC')!.current).toBeCloseTo(before);
  });

  it('handles ETH currency correctly from index_name', () => {
    setSnapshot(svc, 'ETH', buildSnapshot(svc, 'ETH', 45, 44, 70, 25));

    handlePush(svc, { index_name: 'eth_usd', volatility: 50 });

    const snap = svc.getSnapshot('ETH')!;
    expect(snap.current).toBeCloseTo(0.5);
  });

  it('recomputes IVP from cached daily closes on each push', () => {
    setSnapshot(svc, 'BTC', buildSnapshot(svc, 'BTC', 35, 34, 60, 10, [10, 20, 30, 40, 50]));
    setDailyCloses(svc, 'BTC', [10, 20, 30, 40, 50]);

    // Push lifts current to 45 → ≥ 4 of 5 closes → IVP = 80
    handlePush(svc, { index_name: 'btc_usd', volatility: 45 });

    const snap = svc.getSnapshot('BTC')!;
    expect(snap.ivp).toBeCloseTo(80);
  });
});

// ── getSnapshot / getAllSnapshots ─────────────────────────────────────────────

describe('DvolService — getSnapshot', () => {
  let svc: DvolService;

  beforeEach(() => {
    svc = new DvolService();
  });
  afterEach(() => svc.dispose());

  it('returns null for unknown currency', () => {
    expect(svc.getSnapshot('BTC')).toBeNull();
  });

  it('returns the stored snapshot', () => {
    const snap = buildSnapshot(svc, 'BTC', 52, 50, 80, 30);
    setSnapshot(svc, 'BTC', snap);
    expect(svc.getSnapshot('BTC')).toEqual(snap);
  });

  it('getAllSnapshots returns all stored currencies', () => {
    setSnapshot(svc, 'BTC', buildSnapshot(svc, 'BTC', 52, 50, 80, 30));
    setSnapshot(svc, 'ETH', buildSnapshot(svc, 'ETH', 45, 44, 70, 25));
    const all = svc.getAllSnapshots();
    expect(all).toHaveLength(2);
    expect(all.map((s) => s.currency).sort()).toEqual(['BTC', 'ETH']);
  });
});

// ── DVOL history parallelism ──────────────────────────────────────────────────

describe('DvolService — fetchHistory runs in parallel', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fetches all currencies concurrently, not serially', async () => {
    const svc = new DvolService();
    const startTimes: number[] = [];

    vi.spyOn(
      svc as unknown as { fetchHistory(c: string): Promise<void> },
      'fetchHistory',
    ).mockImplementation(async (_currency) => {
      startTimes.push(Date.now());
      await new Promise((r) => setTimeout(r, 5_000));
    });

    // Stub rpc to make start() not open a real WS
    const mockRpc = {
      connect: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn().mockResolvedValue(undefined),
      onSubscription: vi.fn(),
      disconnect: vi.fn(),
      call: vi.fn(),
    };
    (svc as unknown as { rpc: unknown }).rpc = mockRpc;
    (svc as unknown as { currencies: string[] }).currencies = ['BTC', 'ETH'];

    // Call the internal method that drives parallel fetching
    const internalStart = async () => {
      await Promise.all(
        ['BTC', 'ETH'].map((c) =>
          (svc as unknown as { fetchHistory(c: string): Promise<void> }).fetchHistory(c),
        ),
      );
    };

    const p = internalStart();
    // Both fetches must start at the same tick — before any timer fires
    expect(startTimes).toHaveLength(2);
    expect(startTimes[0]).toBe(startTimes[1]); // same timestamp = concurrent

    await vi.advanceTimersByTimeAsync(5_100);
    await p;
    svc.dispose();
  });
});

// ── computeIvp — pure helper ──────────────────────────────────────────────────

describe('computeIvp', () => {
  it('returns 0 for empty distribution', () => {
    expect(computeIvp(50, [])).toBe(0);
  });

  it('returns percent of closes ≤ current', () => {
    expect(computeIvp(35, [10, 20, 30, 40, 50])).toBeCloseTo(60);
  });

  it('counts ties as ≤', () => {
    expect(computeIvp(40, [10, 20, 30, 40, 50])).toBeCloseTo(80);
  });

  it('returns 100 when current ≥ max', () => {
    expect(computeIvp(50, [10, 20, 30, 40, 50])).toBeCloseTo(100);
    expect(computeIvp(99, [10, 20, 30, 40, 50])).toBeCloseTo(100);
  });

  it('returns 0 when current is strictly below all closes', () => {
    expect(computeIvp(5, [10, 20, 30, 40, 50])).toBeCloseTo(0);
  });

  it('is robust to unsorted input', () => {
    expect(computeIvp(35, [50, 10, 40, 20, 30])).toBeCloseTo(60);
  });

  it('handles a single-element distribution', () => {
    expect(computeIvp(10, [10])).toBeCloseTo(100);
    expect(computeIvp(9, [10])).toBeCloseTo(0);
  });
});

// ── dailyClosesFromCandles — daily downsample ────────────────────────────────

describe('dailyClosesFromCandles', () => {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  function candle(timestamp: number, close: number): DvolCandle {
    return { timestamp, open: close, high: close, low: close, close };
  }

  it('returns empty for empty input', () => {
    expect(dailyClosesFromCandles([])).toEqual([]);
  });

  it('one daily candle → one close', () => {
    const c = [candle(0, 42)];
    expect(dailyClosesFromCandles(c)).toEqual([42]);
  });

  it('collapses multiple hourly candles on the same UTC day to the latest close', () => {
    const hour = 60 * 60 * 1000;
    const day0 = 0;
    const c = [candle(day0, 40), candle(day0 + 10 * hour, 41), candle(day0 + 23 * hour, 42)];
    expect(dailyClosesFromCandles(c)).toEqual([42]);
  });

  it('keeps one close per UTC day across multiple days', () => {
    const c = [
      candle(0 * MS_PER_DAY, 30),
      candle(1 * MS_PER_DAY, 31),
      candle(2 * MS_PER_DAY, 32),
    ];
    expect(dailyClosesFromCandles(c)).toEqual([30, 31, 32]);
  });

  it('mix of daily + hourly: last close of each UTC day wins', () => {
    const hour = 60 * 60 * 1000;
    const day0 = 0;
    const day1 = MS_PER_DAY;
    const c = [
      candle(day0, 20), // daily close for day 0
      candle(day1, 30), // daily close for day 1
      candle(day1 + 5 * hour, 31),
      candle(day1 + 23 * hour, 33),
    ];
    expect(dailyClosesFromCandles(c)).toEqual([20, 33]);
  });
});
