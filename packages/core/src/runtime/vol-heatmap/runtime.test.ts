import { MessageChannel, type MessagePort } from 'node:worker_threads';
import type { VolHeatmapColumn } from '@oggregator/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VolHeatmapFeedEvents } from './feed.js';
import { mergeHeatmapColumns, VolHeatmapRuntime, type VolHeatmapWorkerHandle } from './runtime.js';
import { serveVolHeatmapWorker } from './worker-protocol.js';

const column = (t: number, cells: VolHeatmapColumn['cells'], dvol: number | null = null): VolHeatmapColumn => ({
  t,
  dvol,
  cells,
  trades: [],
});

describe('mergeHeatmapColumns', () => {
  it('averages cells over the columns present in each slot', () => {
    const merged = mergeHeatmapColumns(
      [
        column(0, [[148, 100, 0]], 0.37),
        column(15_000, [[148, 50, 10]]),
        column(60_000, [[150, 0, 30]], 0.38),
      ],
      60_000,
    );
    expect(merged).toEqual([
      { t: 0, dvol: 0.37, cells: [[148, 75, 5]], trades: [] },
      { t: 60_000, dvol: 0.38, cells: [[150, 0, 30]], trades: [] },
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
    const runtime = new VolHeatmapRuntime({ spawn: worker.spawn, retentionMs: 30_000 });
    runtime.start(['BTC']);
    await vi.waitFor(() => expect(events).not.toBeNull());

    events!.onMeta('BTC', { expiries: ['2026-11-27'], instruments: 12, updatedAt: 1 });
    for (const t of [0, 15_000, 30_000, 45_000]) events!.onColumn('BTC', column(t, [[148, t, 0]]));
    events!.onColumn('BTC', column(30_000, []));

    await vi.waitFor(() => expect(runtime.getColumns('BTC').map((c) => c.t)).toEqual([15_000, 30_000, 45_000]));
    expect(runtime.getColumns('BTC', 30_000).map((c) => c.t)).toEqual([30_000, 45_000]);
    expect(runtime.getMeta('BTC')?.instruments).toBe(12);
    await runtime.dispose();
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
