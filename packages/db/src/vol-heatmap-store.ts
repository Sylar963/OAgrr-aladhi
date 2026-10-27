import {
  VOL_HEATMAP_RETENTION_MS,
  type VolHeatmapHistoryRecord,
  VolHeatmapHistoryRecordSchema,
} from '@oggregator/protocol';
import type { Pool } from 'pg';
import {
  appendJsonLines,
  type DeferredLog,
  FlushSchedule,
  readJsonLines,
  rewriteJsonLines,
} from './deferred-persistence.js';
import { createPgPool } from './pg-pool.js';

const HOUR_MS = 3_600_000;
const INSERT_BATCH_SIZE = 250;

interface VolHeatmapStoreOptions {
  cachePath: string;
  connectionString?: string | undefined;
  pool?: Pool;
  flushIntervalMs?: number;
  now?: () => number;
}

function key(row: VolHeatmapHistoryRecord): string {
  return `${row.currency}:${row.column.t}`;
}

export class VolHeatmapHistoryStore {
  private readonly pool: Pool | null;
  private readonly now: () => number;
  private readonly rows = new Map<string, VolHeatmapHistoryRecord>();
  private readonly schedule: FlushSchedule;
  private readonly compactTimer: ReturnType<typeof setInterval>;
  private flushing: Promise<void> | null = null;

  constructor(
    private readonly options: VolHeatmapStoreOptions,
    private readonly log: DeferredLog,
  ) {
    this.now = options.now ?? Date.now;
    this.pool = options.pool ?? (options.connectionString
      ? createPgPool({ connectionString: options.connectionString, connectionTimeoutMillis: 10_000 })
      : null);
    for (const row of readJsonLines(options.cachePath, (value) => VolHeatmapHistoryRecordSchema.parse(value), log)) {
      this.rows.set(key(row), row);
    }
    // Rewriting also removes a torn final line before the next append after a crash.
    this.compact();
    this.compactTimer = setInterval(() => {
      try {
        this.compact();
      } catch (err: unknown) {
        this.log.warn({ err: String(err) }, 'vol heatmap cache compaction failed');
      }
    }, HOUR_MS);
    this.compactTimer.unref();
    this.schedule = new FlushSchedule(
      options.cachePath,
      Math.max(VOL_HEATMAP_RETENTION_MS, options.flushIntervalMs ?? VOL_HEATMAP_RETENTION_MS),
      () => this.flush(),
      (err: unknown) => this.log.warn({ err: String(err) }, 'vol heatmap daily sync failed'),
      this.now(),
    );
  }

  append(input: VolHeatmapHistoryRecord): void {
    const row = VolHeatmapHistoryRecordSchema.parse(input);
    const now = this.now();
    if (row.column.t < now - VOL_HEATMAP_RETENTION_MS || row.column.t > now) return;
    if (this.rows.has(key(row))) return;
    appendJsonLines(this.options.cachePath, [row], (value) => value);
    this.rows.set(key(row), row);
    this.pruneMemory();
  }

  async loadSince(since: number): Promise<VolHeatmapHistoryRecord[]> {
    if (this.pool != null) {
      try {
        const result = await this.pool.query<{ record: unknown }>(
          'SELECT record FROM vol_heatmap_columns WHERE slot_ts >= $1 ORDER BY slot_ts ASC',
          [new Date(Math.max(since, this.now() - VOL_HEATMAP_RETENTION_MS))],
        );
        for (const { record } of result.rows) {
          const parsed = VolHeatmapHistoryRecordSchema.safeParse(record);
          if (!parsed.success) {
            this.log.warn({}, 'skipping malformed vol heatmap database row');
            continue;
          }
          const row = parsed.data;
          if (!this.rows.has(key(row))) this.rows.set(key(row), row);
        }
        this.compact();
      } catch (err: unknown) {
        this.log.warn({ err: String(err) }, 'vol heatmap database hydrate failed; using local history');
      }
    }
    this.pruneMemory();
    return [...this.rows.values()].filter((row) => row.column.t >= since)
      .sort((a, b) => a.column.t - b.column.t);
  }

  flush(): Promise<void> {
    this.flushing ??= this.sync().finally(() => { this.flushing = null; });
    return this.flushing;
  }

  async dispose(): Promise<void> {
    this.schedule.dispose();
    clearInterval(this.compactTimer);
    try {
      await this.flushing;
    } finally {
      await this.pool?.end();
    }
  }

  private pruneMemory(): void {
    const now = this.now();
    const cutoff = now - VOL_HEATMAP_RETENTION_MS;
    for (const [id, row] of this.rows) {
      if (row.column.t < cutoff || row.column.t > now) this.rows.delete(id);
    }
  }

  private compact(): void {
    this.pruneMemory();
    rewriteJsonLines(this.options.cachePath, [...this.rows.values()], (row) => row);
  }

  private async sync(): Promise<void> {
    this.compact();
    if (this.pool == null) return;
    // The entire retained window is retried idempotently; failed syncs never clear local data.
    const rows = [...this.rows.values()];
    for (let index = 0; index < rows.length; index += INSERT_BATCH_SIZE) {
      const values: unknown[] = [];
      const placeholders = rows.slice(index, index + INSERT_BATCH_SIZE).map((row, i) => {
        values.push(row.currency, new Date(row.column.t), JSON.stringify(row));
        return `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3}::jsonb)`;
      });
      await this.pool.query(
        `INSERT INTO vol_heatmap_columns (currency, slot_ts, record) VALUES ${placeholders.join(', ')}
         ON CONFLICT (currency, slot_ts) DO NOTHING`,
        values,
      );
    }
    await this.pool.query('DELETE FROM vol_heatmap_columns WHERE slot_ts < $1', [
      new Date(this.now() - VOL_HEATMAP_RETENTION_MS),
    ]);
  }
}
