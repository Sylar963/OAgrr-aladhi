import type { FlowOiTick } from '@oggregator/protocol';
import type { QuoteRecorderEvent } from '../feeds/shared/sdk-base.js';

export class FlowOiRecorder {
  private readonly latest = new Map<string, { timestamp: number; savedAt: number; oi: number }>();

  constructor(private readonly write: (tick: FlowOiTick) => void, private readonly now = Date.now) {}

  record(event: QuoteRecorderEvent): void {
    const oi = event.openInterest;
    if (!oi || !Number.isFinite(oi.value) || oi.value < 0 || !Number.isSafeInteger(oi.timestamp)) return;
    const now = this.now();
    if (oi.timestamp > now + 5_000 || oi.timestamp < now - 60_000) return;
    const key = `${event.venue}:${event.exchangeSymbol}`;
    const previous = this.latest.get(key);
    if (previous && oi.timestamp <= previous.timestamp) return;
    if (previous && oi.value === previous.oi && oi.timestamp - previous.savedAt < 300_000) {
      previous.timestamp = oi.timestamp;
      return;
    }
    this.write({
      venue: event.venue, instrument: event.exchangeSymbol, underlying: oi.underlying,
      timestamp: oi.timestamp, observedAt: now, openInterest: oi.value,
    });
    this.latest.set(key, { timestamp: oi.timestamp, savedAt: oi.timestamp, oi: oi.value });
    if (this.latest.size > 30_000) this.latest.delete(this.latest.keys().next().value!);
  }
}
