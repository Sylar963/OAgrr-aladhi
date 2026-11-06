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
    const oi = event.openInterest;
    if (!oi || !Number.isFinite(oi.value) || oi.value < 0 || !Number.isSafeInteger(oi.timestamp))
      return;
    const now = this.now();
    if (oi.timestamp > now + 5_000 || oi.timestamp < now - 60_000) return;
    const key = `${event.venue}:${event.exchangeSymbol}`;
    const previous = this.latest.get(key);
    if (previous && oi.timestamp <= previous.timestamp) return;
    const activeUntil = this.activeTrades.get(key) ?? 0;
    if (previous && oi.value === previous.oi && oi.timestamp - previous.savedAt < (activeUntil > now ? 1_000 : 300_000)) {
      previous.timestamp = oi.timestamp;
      return;
    }
    this.write({
      venue: event.venue,
      instrument: event.exchangeSymbol,
      underlying: oi.underlying,
      timestamp: oi.timestamp,
      observedAt: now,
      openInterest: oi.value,
      timing: oi.timing ?? 'sampled',
    });
    this.latest.set(key, { timestamp: oi.timestamp, savedAt: oi.timestamp, oi: oi.value });
    if (this.latest.size > 30_000) this.latest.delete(this.latest.keys().next().value!);
  }
}
