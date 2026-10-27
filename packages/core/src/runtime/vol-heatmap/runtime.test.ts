import { MessageChannel, type MessagePort } from 'node:worker_threads';
import { VOL_HEATMAP_RETENTION_MS, type VolHeatmapColumn, type VolHeatmapHistoryRecord } from '@oggregator/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VolHeatmapFeedEvents } from './feed.js';
import { mergeHeatmapColumns, VolHeatmapRuntime, type VolHeatmapHistory, type VolHeatmapWorkerHandle } from './runtime.js';
import { serveVolHeatmapWorker } from './worker-protocol.js';

const column = (t: number, cells: VolHeatmapColumn['cells'], dvol: number | null = null): VolHeatmapColumn => ({
  t,
  dvol,
  cells,
  adjCells: [],
  atmMid: null,
  trades: [],
});

describe('mergeHeatmapColumns', () => {
  it('averages raw and skew-adjusted cells over the columns present in each slot', () => {
    const merged = mergeHeatmapColumns(
      [
        { ...column(0, [[148, 100, 0]], 0.37), adjCells: [[146, 40, 0]], atmMid: 0.365 },
        column(15_000, [[148, 50, 10]]),
        column(60_000, [[150, 0, 30]], 0.38),
      ],
      60_000,
    );
    expect(merged).toEqual([
      { t: 0, dvol: 0.37, cells: [[148, 75, 5]], adjCells: [[146, 20, 0]], atmMid: 0.365, trades: [] },
      { t: 60_000, dvol: 0.38, cells: [[150, 0, 30]], adjCells: [], atmMid: null, trades: [] },
    ]);
  });
});

const channels: MessageChannel[] = [];
afterEach(() => {
  for (const c of channels.splice(0)) {
    c.port1.close();
    c.port2.close();
  }
});

/** Runs the worker side in-process over a MessageChannel. */
function inProcessWorker(onFeed: (events: VolHeatmapFeedEvents) => void) {
  const exits: Array<(code: number) => void> = [];
  const spawn = (): VolHeatmapWorkerHandle => {
    const channel = new MessageChannel();
    channels.push(channel);
    serveVolHeatmapWorker(channel.port2 as MessagePort, (_currencies, events) => {
      onFeed(events);
      return { start: async () => {}, stop: async () => {} };
    });
    return {
      port: channel.port1,
      terminate: async () => channel.port1.close(),
      onExit: (listener) => exits.push(listener),
    };
  };
  return { spawn, exit: (code: number) => exits.forEach((l) => l(code)) };
}

describe('VolHeatmapRuntime', () => {
  it('buffers columns from the worker and trims past the retention window', async () => {
    let events: VolHeatmapFeedEvents | null = null;
    const worker = inProcessWorker((e) => (events = e));
    let now = 45_000;
    const runtime = new VolHeatmapRuntime({ spawn: worker.spawn, retentionMs: 30_000, now: () => now });
    await runtime.start(['BTC']);
    await vi.waitFor(() => expect(events).not.toBeNull());

    events!.onMeta('BTC', { expiries: ['2026-11-27'], instruments: 12, updatedAt: 1 });
    for (const t of [0, 15_000, 30_000, 45_000]) events!.onColumn('BTC', column(t, [[148, t, 0]]));
    events!.onColumn('BTC', column(30_000, []));

    await vi.waitFor(() => expect(runtime.getColumns('BTC').map((c) => c.t)).toEqual([15_000, 30_000, 45_000]));
    expect(runtime.getColumns('BTC', 30_000).map((c) => c.t)).toEqual([30_000, 45_000]);
    expect(runtime.getMeta('BTC')?.instruments).toBe(12);
    now = 90_000;
    expect(runtime.getColumns('BTC')).toEqual([]);
    await runtime.dispose();
  });

  it('restores both currencies before starting the feed, then persists only new columns', async () => {
    const now = VOL_HEATMAP_RETENTION_MS * 2;
    const btc: VolHeatmapHistoryRecord = {
      currency: 'BTC',
      column: {
        ...column(now - 30_000, [[148, 10, 20]], 0.37),
        adjCells: [[146, 10, 20]],
        atmMid: 0.365,
        trades: [{ t: now - 29_000, instrument: 'BTC-option', side: 'buy', iv: 0.37,
          adjIv: 0.365, amount: 2, vega: 20 }],
      },
      meta: { expiries: ['2026-11-27'], instruments: 12, updatedAt: now - 60_000 },
    };
    const eth: VolHeatmapHistoryRecord = { ...btc, currency: 'ETH' };
    let resolveLoad!: (rows: VolHeatmapHistoryRecord[]) => void;
    const history: VolHeatmapHistory = {
      loadSince: vi.fn(() => new Promise<VolHeatmapHistoryRecord[]>((resolve) => { resolveLoad = resolve; })),
      append: vi.fn(),
      dispose: vi.fn(async () => {}),
    };
    let events: VolHeatmapFeedEvents | null = null;
    const worker = inProcessWorker((e) => (events = e));
    const spawn = vi.fn(worker.spawn);
    const runtime = new VolHeatmapRuntime({ spawn, history, now: () => now });
    const starting = runtime.start(['BTC', 'ETH']);
    expect(spawn).not.toHaveBeenCalled();
    resolveLoad([eth, btc, { ...btc, column: column(now - VOL_HEATMAP_RETENTION_MS - 1, []) }]);
    await starting;
    expect(history.loadSince).toHaveBeenCalledWith(now - VOL_HEATMAP_RETENTION_MS);
    expect(runtime.getColumns('BTC')).toEqual([btc.column]);
    expect(runtime.getColumns('ETH')).toEqual([eth.column]);
    expect(runtime.getMeta('BTC')).toEqual(btc.meta);
    expect(history.append).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(events).not.toBeNull());
    events!.onColumn('BTC', btc.column);
    const next = column(now - 15_000, [[148, 30, 40]]);
    events!.onColumn('BTC', next);
    await vi.waitFor(() => expect(history.append).toHaveBeenCalledExactlyOnceWith({ ...btc, column: next }));
    expect(runtime.getColumns('BTC')).toEqual([btc.column, next]);
    await runtime.dispose();
    expect(history.dispose).toHaveBeenCalledOnce();
  });

  it('does not launch a worker if shutdown starts during history restoration', async () => {
    let resolveLoad!: (rows: VolHeatmapHistoryRecord[]) => void;
    const history: VolHeatmapHistory = {
      loadSince: () => new Promise((resolve) => { resolveLoad = resolve; }),
      append: vi.fn(),
      dispose: vi.fn(async () => {}),
    };
    const spawn = vi.fn();
    const runtime = new VolHeatmapRuntime({ spawn, history });
    const starting = runtime.start(['BTC']);
    const stopping = runtime.dispose();
    resolveLoad([]);
    await Promise.all([starting, stopping]);
    expect(spawn).not.toHaveBeenCalled();
    expect(history.dispose).toHaveBeenCalledOnce();
  });

  it('respawns the worker after an unexpected exit', async () => {
    vi.useFakeTimers();
    try {
      let starts = 0;
      const worker = inProcessWorker(() => starts++);
      const spawn = vi.fn(worker.spawn);
      const runtime = new VolHeatmapRuntime({ spawn });
      runtime.start(['BTC']);
      worker.exit(1);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(spawn).toHaveBeenCalledTimes(2);
      await runtime.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
