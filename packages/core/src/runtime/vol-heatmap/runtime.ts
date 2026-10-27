import { Worker } from 'node:worker_threads';
import {
  VOL_HEATMAP_RETENTION_MS,
  type VolHeatmapCell,
  type VolHeatmapColumn,
  type VolHeatmapHistoryRecord,
  type VolHeatmapMeta,
} from '@oggregator/protocol';
import { feedLogger } from '../../utils/logger.js';
import type { VolHeatmapPort, VolHeatmapWorkerEvent, VolHeatmapWorkerRequest } from './worker-protocol.js';

const log = feedLogger('vol-heatmap');
const RESPAWN_DELAY_MS = 5_000;

export interface VolHeatmapWorkerHandle {
  port: VolHeatmapPort;
  terminate(): Promise<unknown>;
  onExit(listener: (code: number) => void): void;
}

function spawnVolHeatmapWorker(): VolHeatmapWorkerHandle {
  const worker = new Worker(new URL('./worker.js', import.meta.url));
  // An 'error' event with no listener would be rethrown on the main thread.
  worker.on('error', (error) => log.error({ err: String(error) }, 'vol heatmap worker crashed'));
  return {
    port: worker,
    terminate: () => worker.terminate(),
    onExit: (listener) => worker.on('exit', listener),
  };
}

export interface VolHeatmapRuntimeOptions {
  spawn?: () => VolHeatmapWorkerHandle;
  retentionMs?: number;
  history?: VolHeatmapHistory;
  now?: () => number;
}

export interface VolHeatmapHistory {
  append(row: VolHeatmapHistoryRecord): void;
  loadSince(since: number): Promise<VolHeatmapHistoryRecord[]>;
  dispose(): Promise<void>;
}

export class VolHeatmapRuntime {
  private readonly spawn: () => VolHeatmapWorkerHandle;
  private readonly retentionMs: number;
  private readonly history: VolHeatmapHistory | undefined;
  private readonly now: () => number;
  private readonly columns = new Map<string, VolHeatmapColumn[]>();
  private readonly meta = new Map<string, VolHeatmapMeta>();
  private handle: VolHeatmapWorkerHandle | null = null;
  private currencies: string[] = [];
  private respawnTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private startup: Promise<void> | null = null;

  constructor(options: VolHeatmapRuntimeOptions = {}) {
    this.spawn = options.spawn ?? spawnVolHeatmapWorker;
    this.retentionMs = options.retentionMs ?? VOL_HEATMAP_RETENTION_MS;
    this.history = options.history;
    this.now = options.now ?? Date.now;
  }

  start(currencies: string[]): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.startup == null) {
      this.currencies = currencies;
      this.startup = this.restoreAndLaunch();
    }
    return this.startup;
  }

  getColumns(currency: string, fromMs = 0): VolHeatmapColumn[] {
    this.prune();
    const list = this.columns.get(currency) ?? [];
    const first = list.findIndex((c) => c.t >= fromMs);
    return first === -1 ? [] : list.slice(first);
  }

  getMeta(currency: string): VolHeatmapMeta | null {
    return this.meta.get(currency) ?? null;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.respawnTimer != null) clearTimeout(this.respawnTimer);
    this.respawnTimer = null;
    await this.startup?.catch(() => {});
    const handle = this.handle;
    this.handle = null;
    try {
      if (handle != null) {
        this.send(handle, { t: 'stop' });
        await handle.terminate();
      }
    } finally {
      await this.history?.dispose();
    }
  }

  private async restoreAndLaunch(): Promise<void> {
    if (this.history != null) {
      try {
        const rows = await this.history.loadSince(this.now() - this.retentionMs);
        rows.sort((a, b) => a.column.t - b.column.t);
        for (const row of rows) {
          if (!this.currencies.includes(row.currency)) continue;
          this.receive({ t: 'column', currency: row.currency, column: row.column }, false);
          if (row.meta != null) this.meta.set(row.currency, row.meta);
        }
        log.info({ columns: [...this.columns.values()].reduce((sum, list) => sum + list.length, 0) },
          'vol heatmap history restored');
      } catch (err: unknown) {
        log.error({ err: String(err) }, 'vol heatmap history restore failed');
      }
    }
    if (!this.disposed) this.launch();
  }

  private launch(): void {
    const handle = this.spawn();
    this.handle = handle;
    handle.port.on('message', (message) => this.receive(message as VolHeatmapWorkerEvent));
    handle.onExit((code) => {
      if (this.disposed || this.handle !== handle) return;
      this.handle = null;
      log.warn({ code }, 'vol heatmap worker exited, respawning');
      this.respawnTimer = setTimeout(() => {
        this.respawnTimer = null;
        if (!this.disposed) this.launch();
      }, RESPAWN_DELAY_MS);
    });
    this.send(handle, { t: 'start', currencies: this.currencies });
  }

  private send(handle: VolHeatmapWorkerHandle, message: VolHeatmapWorkerRequest): void {
    handle.port.postMessage(message);
  }

  private receive(event: VolHeatmapWorkerEvent, persist = true): void {
    if (this.disposed) return;
    if (event.t === 'meta') {
      this.meta.set(event.currency, event.meta);
      return;
    }
    if (event.currency !== 'BTC' && event.currency !== 'ETH') return;
    const now = this.now();
    if (event.column.t < now - this.retentionMs || event.column.t > now) return;
    let list = this.columns.get(event.currency);
    if (list == null) {
      list = [];
      this.columns.set(event.currency, list);
    }
    const last = list.at(-1);
    if (last != null && event.column.t <= last.t) return;
    if (persist && this.history != null) {
      try {
        this.history.append({
          currency: event.currency,
          column: event.column,
          meta: this.getMeta(event.currency),
        });
      } catch (err: unknown) {
        log.error({ err: String(err), currency: event.currency }, 'vol heatmap local persistence failed');
      }
    }
    list.push(event.column);
    this.prune();
  }

  private prune(): void {
    const cutoff = this.now() - this.retentionMs;
    for (const list of this.columns.values()) {
      let drop = 0;
      while (drop < list.length && list[drop]!.t < cutoff) drop++;
      if (drop > 0) list.splice(0, drop);
    }
  }
}

/**
 * Coarsens columns onto a `resolutionMs` grid. Cell vega is averaged over the base columns
 * present in each slot (a gap does not dilute it), trades are concatenated and DVOL / ATM mid
 * keep the slot's last value.
 */
export function mergeHeatmapColumns(
  columns: readonly VolHeatmapColumn[],
  resolutionMs: number,
): VolHeatmapColumn[] {
  const out: VolHeatmapColumn[] = [];
  let slot: {
    t: number;
    count: number;
    raw: CellSums;
    adjusted: CellSums;
    dvol: number | null;
    atmMid: number | null;
    trades: VolHeatmapColumn['trades'];
  } | null = null;

  const close = (): void => {
    if (slot == null) return;
    out.push({
      t: slot.t,
      dvol: slot.dvol,
      cells: slot.raw.average(slot.count),
      adjCells: slot.adjusted.average(slot.count),
      atmMid: slot.atmMid,
      trades: slot.trades,
    });
  };

  for (const column of columns) {
    const t = Math.floor(column.t / resolutionMs) * resolutionMs;
    if (slot == null || slot.t !== t) {
      close();
      slot = { t, count: 0, raw: new CellSums(), adjusted: new CellSums(), dvol: null, atmMid: null, trades: [] };
    }
    slot.count++;
    slot.raw.add(column.cells);
    slot.adjusted.add(column.adjCells);
    if (column.dvol != null) slot.dvol = column.dvol;
    if (column.atmMid != null) slot.atmMid = column.atmMid;
    for (const trade of column.trades) slot.trades.push(trade);
  }
  close();
  return out;
}

class CellSums {
  private readonly bid = new Map<number, number>();
  private readonly ask = new Map<number, number>();

  add(cells: readonly VolHeatmapCell[]): void {
    for (const [bucket, bid, ask] of cells) {
      if (bid > 0) this.bid.set(bucket, (this.bid.get(bucket) ?? 0) + bid);
      if (ask > 0) this.ask.set(bucket, (this.ask.get(bucket) ?? 0) + ask);
    }
  }

  average(count: number): VolHeatmapCell[] {
    const buckets = new Set<number>([...this.bid.keys(), ...this.ask.keys()]);
    return [...buckets]
      .sort((a, b) => a - b)
      .map((bucket) => [
        bucket,
        Math.round((this.bid.get(bucket) ?? 0) / count),
        Math.round((this.ask.get(bucket) ?? 0) / count),
      ]);
  }
}
