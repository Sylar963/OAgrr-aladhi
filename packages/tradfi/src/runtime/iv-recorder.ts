import {
  buildSurfaceGridEntry,
  IvHistoryService,
  type IvHistoryPersistence,
  type IvSurfaceRow,
} from '@oggregator/core';
import type { FeedLike } from '../app.js';
import { expiryCloseTs } from '../tastytrade/instrument.js';
import { buildVenueChain, TASTYTRADE_VENUE } from './chain.js';
import type { TradfiStore } from './store.js';

const TENOR_DAYS = [7, 30, 60, 90];
const DAY_MS = 86_400_000;
const KEEP_WARM_MS = 60_000;
// A chain subscribed less than a minute ago may still be missing quotes; skip that sample.
const MIN_WARM_MS = 60_000;
// Holidays and halts leave the delayed feed frozen inside regular hours.
const SPOT_STALE_MS = 15 * 60_000;
const SESSION_OPEN_MIN = 9 * 60 + 30;
const SESSION_CLOSE_MIN = 16 * 60;

const nyClock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Weekdays 9:30–16:00 New York time. */
export function inRegularSession(now: number): boolean {
  const parts = Object.fromEntries(nyClock.formatToParts(new Date(now)).map((p) => [p.type, p.value]));
  if (parts.weekday === 'Sat' || parts.weekday === 'Sun') return false;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return minutes >= SESSION_OPEN_MIN && minutes < SESSION_CLOSE_MIN;
}

/** The expiries on each side of every tenor: all variance-time interpolation reads. */
export function bracketExpiries(
  expiries: ReadonlyArray<{ expiry: string; expiryTs: number }>,
  now: number,
): string[] {
  const live = expiries.filter((e) => e.expiryTs > now).sort((a, b) => a.expiryTs - b.expiryTs);
  const picked = new Set<string>();
  for (const days of TENOR_DAYS) {
    const above = live.findIndex((e) => e.expiryTs >= now + days * DAY_MS);
    if (above === -1) {
      const last = live.at(-1);
      if (last) picked.add(last.expiry);
      continue;
    }
    picked.add(live[above]!.expiry);
    if (above > 0) picked.add(live[above - 1]!.expiry);
  }
  return [...picked];
}

const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

export interface IvRecorderDeps {
  store: TradfiStore;
  feed: Pick<FeedLike, 'ensureChainSubscribed'>;
  persistence: IvHistoryPersistence;
  underlyings: string[];
}

/**
 * Samples 7/30/60/90-day ATM IV and 25Δ/10Δ skew every 5 minutes during regular hours,
 * keeping only the bracketing expiries of each recorded underlying subscribed.
 */
export class TradfiIvRecorder {
  readonly history: IvHistoryService;
  private readonly spots = new Map<string, { spot: number; changedAt: number }>();
  private readonly warmSince = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deps: IvRecorderDeps) {
    this.history = new IvHistoryService(
      { getSurfaceGrid: (u) => this.surfaceRows(u), store: deps.persistence },
      { underlyings: deps.underlyings, expiryTime: expiryCloseTs },
    );
  }

  async start(): Promise<void> {
    await this.history.start();
    this.keepWarm();
    this.timer = setInterval(() => this.keepWarm(), KEEP_WARM_MS);
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.history.dispose();
  }

  keepWarm(now = Date.now()): void {
    const open = inRegularSession(now);
    for (const underlying of this.deps.underlyings) {
      const spot = this.deps.store.getSpot(underlying);
      const seen = this.spots.get(underlying);
      // changedAt starts at 0 so a restart on a holiday never counts the frozen spot as live.
      if (spot != null && seen?.spot !== spot) {
        this.spots.set(underlying, { spot, changedAt: seen == null ? 0 : now });
      }
      if (!open) {
        this.warmSince.delete(underlying);
        continue;
      }
      if (!this.warmSince.has(underlying)) this.warmSince.set(underlying, now);
      for (const expiry of this.selectedExpiries(underlying, now)) {
        this.deps.feed.ensureChainSubscribed(underlying, expiry);
      }
    }
  }

  async surfaceRows(underlying: string, now = Date.now()): Promise<IvSurfaceRow[]> {
    if (!inRegularSession(now)) return [];
    const warmedAt = this.warmSince.get(underlying);
    if (warmedAt == null || now - warmedAt < MIN_WARM_MS) return [];
    const changedAt = this.spots.get(underlying)?.changedAt ?? 0;
    if (now - changedAt > SPOT_STALE_MS) return [];

    const rows: IvSurfaceRow[] = [];
    for (const expiry of this.selectedExpiries(underlying, now)) {
      await yieldToEventLoop();
      const chain = buildVenueChain(this.deps.store, underlying, expiry);
      const entry = buildSurfaceGridEntry(underlying, expiry, [chain], {
        venues: [TASTYTRADE_VENUE],
        expiryTs: expiryCloseTs(expiry),
      });
      rows.push(entry.surfaceRow);
    }
    return rows;
  }

  private selectedExpiries(underlying: string, now: number): string[] {
    const expiries = this.deps.store
      .listExpiries(underlying)
      .map((expiry) => ({ expiry, expiryTs: expiryCloseTs(expiry) }));
    return bracketExpiries(expiries, now);
  }
}
