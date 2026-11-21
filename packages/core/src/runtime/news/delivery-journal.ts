import { createHash, randomUUID } from 'node:crypto';
import type { NewsDeliveryEvent, NewsObservation } from '@oggregator/protocol';

export interface NewsDeliveryStore {
  read(): NewsDeliveryEvent[];
  append(events: NewsDeliveryEvent[]): void;
  replace(events: NewsDeliveryEvent[]): void;
}

export class NewsCursorError extends Error {
  constructor(readonly oldestCursor: string | null) {
    super('News cursor is outside retained delivery history; replay from the oldest cursor');
  }
}

function fingerprint(item: NewsObservation): string {
  return createHash('sha256').update(JSON.stringify(item)).digest('hex');
}

export class NewsDeliveryJournal {
  private events: NewsDeliveryEvent[];
  private readonly latest = new Map<string, { event: NewsDeliveryEvent; fingerprint: string }>();
  private readonly epoch: string;
  private sequence: number;
  private writeFailed = false;

  constructor(
    private readonly store: NewsDeliveryStore,
    private readonly maxEvents = 50_000,
    private readonly now: () => number = Date.now,
  ) {
    if (!Number.isInteger(maxEvents) || maxEvents < 1) throw new Error('Invalid news retention');
    this.events = store.read();
    let previous = 0;
    const epoch = this.events[0]?.cursor.split(':')[0];
    for (const event of this.events) {
      if (event.sequence !== previous + 1 && previous !== 0)
        throw new Error('News journal sequence gap');
      if (event.cursor !== `${epoch}:${event.sequence}`)
        throw new Error('News journal cursor mismatch');
      previous = event.sequence;
    }
    this.epoch = epoch ?? randomUUID();
    this.sequence = this.events.at(-1)?.sequence ?? 0;
    this.events = this.events.slice(-maxEvents);
    this.reindex();
  }

  get cursor(): string {
    return `${this.epoch}:${this.sequence}`;
  }
  get oldestCursor(): string | null {
    const first = this.events[0];
    return first ? `${this.epoch}:${first.sequence - 1}` : null;
  }
  get size(): number {
    return this.events.length;
  }

  record(items: NewsObservation[], options: { backfill?: boolean } = {}): void {
    if (this.writeFailed)
      throw new Error('News journal write failed; restart after restoring storage');
    const staged = new Map(this.latest);
    const fresh: NewsDeliveryEvent[] = [];
    const receivedAt = this.now();
    for (const observation of items) {
      const previous = staged.get(observation.id);
      const hash = fingerprint(observation);
      if (previous?.fingerprint === hash) continue;
      const sequence = this.sequence + fresh.length + 1;
      const event: NewsDeliveryEvent = {
        cursor: `${this.epoch}:${sequence}`,
        sequence,
        receivedAt,
        firstReceivedAt: previous?.event.firstReceivedAt ?? receivedAt,
        revision: (previous?.event.revision ?? 0) + 1,
        backfill: options.backfill ?? false,
        observation,
      };
      fresh.push(event);
      staged.set(observation.id, { event, fingerprint: hash });
    }
    if (fresh.length === 0) return;
    try {
      this.store.append(fresh);
    } catch (error) {
      this.writeFailed = true;
      throw error;
    }
    this.events.push(...fresh);
    this.sequence = fresh.at(-1)!.sequence;
    const trimmed = this.events.length > this.maxEvents;
    if (trimmed) {
      this.events = this.events.slice(-Math.ceil(this.maxEvents * 0.9));
      this.reindex();
      try {
        this.store.replace(this.events);
      } catch (error) {
        this.writeFailed = true;
        throw error;
      }
    }
    if (!trimmed)
      for (const event of fresh)
        this.latest.set(event.observation.id, {
          event,
          fingerprint: fingerprint(event.observation),
        });
  }

  page(after: string | undefined, limit: number) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 200)
      throw new Error('Invalid news page size');
    let sequence = this.events[0] ? this.events[0].sequence - 1 : this.sequence;
    if (after !== undefined) {
      const parts = after.split(':');
      const value = Number(parts[1]);
      if (
        parts.length !== 2 ||
        parts[0] !== this.epoch ||
        !/^\d+$/.test(parts[1] ?? '') ||
        !Number.isSafeInteger(value) ||
        value < sequence ||
        value > this.sequence
      ) {
        throw new NewsCursorError(this.oldestCursor);
      }
      sequence = value;
    }
    const offset = this.events[0] ? sequence - this.events[0].sequence + 1 : 0;
    const events = this.events.slice(offset, offset + limit);
    return {
      events,
      nextCursor: events.at(-1)?.cursor ?? `${this.epoch}:${sequence}`,
      hasMore: offset + events.length < this.events.length,
      oldestCursor: this.oldestCursor,
    };
  }

  private reindex(): void {
    this.latest.clear();
    for (const event of this.events) {
      this.latest.set(event.observation.id, { event, fingerprint: fingerprint(event.observation) });
    }
  }
}
