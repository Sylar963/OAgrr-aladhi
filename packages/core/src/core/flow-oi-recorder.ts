import type { FlowOiTick } from '@oggregator/protocol';
import type { QuoteRecorderEvent } from '../feeds/shared/sdk-base.js';

export class FlowOiRecorder {
  private readonly latest = new Map<string, { timestamp: number; savedAt: number; oi: number }>();
  private readonly activeTrades = new Map<string, number>();

  constructor(
    private readonly write: (tick: FlowOiTick) => void,
    private readonly now = Date.now,
  ) {}

  observeTrade(venue: string, instrument: string, timestamp: number): void {
    this.activeTrades.set(`${venue}:${instrument}`, timestamp + 30 * 60_000);
  }

  record(event: QuoteRecorderEvent): void {
    this.recordBatch([event]);
  }

  recordBatch(
    events: readonly QuoteRecorderEvent[],
    writeBatch: (ticks: readonly FlowOiTick[]) => void = (ticks) => {
      for (const tick of ticks) this.write(tick);
    },
  ): void {
    const updates = new Map<string, { timestamp: number; savedAt: number; oi: number }>();
    const ticks: FlowOiTick[] = [];
    const now = this.now();
    for (const event of events) this.capture(event, now, updates, ticks);
    if (ticks.length > 0) writeBatch(ticks);
    for (const [key, value] of updates) this.latest.set(key, value);
    while (this.latest.size > 30_000) this.latest.delete(this.latest.keys().next().value!);
  }

  private capture(
    event: QuoteRecorderEvent,
    now: number,
    updates: Map<string, { timestamp: number; savedAt: number; oi: number }>,
    ticks: FlowOiTick[],
  ): void {
    const oi = event.openInterest;
    if (!oi || !Number.isFinite(oi.value) || oi.value < 0 || !Number.isSafeInteger(oi.timestamp))
      return;
    if (oi.timestamp > now + 5_000 || oi.timestamp < now - 60_000) return;
    const key = `${event.venue}:${event.exchangeSymbol}`;
    const previous = updates.get(key) ?? this.latest.get(key);
    if (previous && oi.timestamp <= previous.timestamp) return;
    const activeUntil = this.activeTrades.get(key) ?? 0;
    if (previous && oi.value === previous.oi && oi.timestamp - previous.savedAt < (activeUntil > now ? 1_000 : 300_000)) {
      updates.set(key, { ...previous, timestamp: oi.timestamp });
      return;
    }
    ticks.push({
      venue: event.venue,
      instrument: event.exchangeSymbol,
      underlying: oi.underlying,
      timestamp: oi.timestamp,
      observedAt: now,
      openInterest: oi.value,
      timing: oi.timing ?? 'sampled',
    });
    updates.set(key, { timestamp: oi.timestamp, savedAt: oi.timestamp, oi: oi.value });
  }
}
