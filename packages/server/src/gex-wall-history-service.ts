import { computeGammaWalls, type GexStrike } from '@oggregator/core';
import type { GexWallSnapshotStore, PersistedGexWallSnapshot } from '@oggregator/db';
import {
  GEX_WALL_HISTORY_MAX_DAYS,
  GEX_WALL_HISTORY_RESOLUTION_SEC,
  type GexWallHistoryPoint,
  type GexWallHistoryResponse,
} from '@oggregator/protocol';

export const GEX_WALL_SLOT_MS = GEX_WALL_HISTORY_RESOLUTION_SEC * 1000;
export const GEX_WALL_RETENTION_MS = GEX_WALL_HISTORY_MAX_DAYS * 24 * 60 * 60 * 1000;
// Sample a little after the boundary so every venue has published its tick for the slot.
const SAMPLE_OFFSET_MS = 5_000;
// First sample lands shortly after boot (adapters warm up) instead of waiting up to a full slot.
const INITIAL_SAMPLE_DELAY_MS = 60_000;

export interface GexWallInputs {
  spotPrice: number | null;
  gex: GexStrike[];
}

interface GexWallLog {
  debug: (obj: object, msg: string) => void;
  warn: (obj: object, msg: string) => void;
}

export interface GexWallHistoryServiceOptions {
  underlyings: readonly string[];
  store: Pick<GexWallSnapshotStore, 'writeMany' | 'loadSince'>;
  getInputs: (underlying: string) => Promise<GexWallInputs>;
  now?: () => number;
  log?: GexWallLog;
}

export function slotStart(ts: number): number {
  return Math.floor(ts / GEX_WALL_SLOT_MS) * GEX_WALL_SLOT_MS;
}

export function buildGexWallPoint(
  slotTs: number,
  inputs: GexWallInputs,
): GexWallHistoryPoint | null {
  const spot = inputs.spotPrice;
  if (inputs.gex.length === 0 || spot == null || !Number.isFinite(spot)) return null;
  return { ts: slotTs, spot, ...computeGammaWalls(inputs.gex, spot) };
}

export function nextSampleDelay(now: number): number {
  return slotStart(now - SAMPLE_OFFSET_MS) + GEX_WALL_SLOT_MS + SAMPLE_OFFSET_MS - now;
}

function toPoint(row: PersistedGexWallSnapshot): GexWallHistoryPoint {
  return {
    ts: row.slotTs.getTime(),
    spot: row.spot,
    callWall: row.callWall,
    putWall: row.putWall,
    gammaFlip: row.gammaFlip,
  };
}

/** Samples 15-minute GEX walls into an in-memory series; reads never touch storage. */
export class GexWallHistoryService {
  private readonly series = new Map<string, GexWallHistoryPoint[]>();
  private readonly now: () => number;
  private log: GexWallLog;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private started = false;

  constructor(private readonly options: GexWallHistoryServiceOptions) {
    this.now = options.now ?? Date.now;
    this.log = options.log ?? { debug: () => {}, warn: (obj, msg) => console.warn(msg, obj) };
  }

  setLogger(log: GexWallLog): void {
    this.log = log;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    try {
      const rows = await this.options.store.loadSince(
        new Date(this.now() - GEX_WALL_RETENTION_MS),
      );
      for (const row of rows) this.insert(row.underlying, toPoint(row));
    } catch (err: unknown) {
      this.log.warn({ err: String(err) }, 'GEX-wall history hydrate failed');
    }
    this.scheduleNext(INITIAL_SAMPLE_DELAY_MS);
  }

  dispose(): void {
    this.started = false;
    if (this.timer != null) clearTimeout(this.timer);
    this.timer = null;
  }

  query(underlying: string, days: number): GexWallHistoryResponse {
    const key = underlying.toUpperCase();
    const since = this.now() - days * 24 * 60 * 60 * 1000;
    const points = (this.series.get(key) ?? []).filter((point) => point.ts >= since);
    return { underlying: key, resolutionSec: GEX_WALL_HISTORY_RESOLUTION_SEC, points };
  }

  async sampleAll(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const slotTs = slotStart(this.now());
      for (const underlying of this.options.underlyings) {
        await this.sampleOne(underlying, slotTs);
      }
    } finally {
      this.running = false;
    }
  }

  private async sampleOne(underlying: string, slotTs: number): Promise<void> {
    const key = underlying.toUpperCase();
    if (this.series.get(key)?.some((point) => point.ts === slotTs)) return;
    try {
      const point = buildGexWallPoint(slotTs, await this.options.getInputs(key));
      if (point == null) {
        this.log.debug({ underlying: key, slotTs }, 'GEX-wall sample skipped: no gex or spot');
        return;
      }
      this.insert(key, point);
      await this.options.store.writeMany([
        {
          underlying: key,
          slotTs: new Date(point.ts),
          spot: point.spot,
          callWall: point.callWall,
          putWall: point.putWall,
          gammaFlip: point.gammaFlip,
        },
      ]);
    } catch (err: unknown) {
      this.log.warn({ underlying: key, err: String(err) }, 'GEX-wall sample failed');
    }
  }

  private insert(underlying: string, point: GexWallHistoryPoint): void {
    const key = underlying.toUpperCase();
    const list = this.series.get(key) ?? [];
    const cutoff = this.now() - GEX_WALL_RETENTION_MS;
    const last = list[list.length - 1];
    if (last == null || last.ts < point.ts) {
      list.push(point);
    } else {
      const index = list.findIndex((existing) => existing.ts >= point.ts);
      if (list[index]?.ts === point.ts) list[index] = point;
      else list.splice(index, 0, point);
    }
    const firstKept = list.findIndex((existing) => existing.ts >= cutoff);
    if (firstKept > 0) list.splice(0, firstKept);
    else if (firstKept === -1) list.length = 0;
    this.series.set(key, list);
  }

  private scheduleNext(maxDelayMs = Number.POSITIVE_INFINITY): void {
    if (!this.started) return;
    const delay = Math.min(nextSampleDelay(this.now()), maxDelayMs);
    this.timer = setTimeout(() => {
      void this.sampleAll().finally(() => this.scheduleNext());
    }, delay);
    this.timer.unref?.();
  }
}
