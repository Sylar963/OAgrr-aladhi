import type { VenueConnectionState } from "../../core/types.js";

/**
 * Assigns topics to connection shards under a per-connection subscription cap
 * (Bybit option public: 2000 args/connection, Paradex: 200 subscriptions/connection).
 * Pure bookkeeping — transports own the sockets and replay `topicsFor(shard)`.
 */
export class TopicShardAllocator {
  private readonly shards: Array<Set<string>> = [];
  private readonly owner = new Map<string, number>();

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error(
        `shard capacity must be a positive integer, got ${capacity}`,
      );
    }
  }

  get shardCount(): number {
    return this.shards.length;
  }

  get size(): number {
    return this.owner.size;
  }

  has(topic: string): boolean {
    return this.owner.has(topic);
  }

  shardOf(topic: string): number | undefined {
    return this.owner.get(topic);
  }

  topicsFor(shard: number): string[] {
    return [...(this.shards[shard] ?? [])];
  }

  /** Assigns topics not yet owned; returns the newly assigned topics grouped by shard. */
  assign(topics: Iterable<string>): Map<number, string[]> {
    const assigned = new Map<number, string[]>();
    let cursor = 0;

    for (const topic of topics) {
      if (this.owner.has(topic)) continue;

      while (
        cursor < this.shards.length &&
        this.shards[cursor]!.size >= this.capacity
      ) {
        cursor += 1;
      }
      if (cursor === this.shards.length) this.shards.push(new Set());

      this.shards[cursor]!.add(topic);
      this.owner.set(topic, cursor);
      const bucket = assigned.get(cursor);
      if (bucket) bucket.push(topic);
      else assigned.set(cursor, [topic]);
    }

    return assigned;
  }

  /** Releases owned topics; returns the released topics grouped by the shard they left. */
  release(topics: Iterable<string>): Map<number, string[]> {
    const released = new Map<number, string[]>();

    for (const topic of topics) {
      const shard = this.owner.get(topic);
      if (shard == null) continue;
      this.owner.delete(topic);
      this.shards[shard]!.delete(topic);
      const bucket = released.get(shard);
      if (bucket) bucket.push(topic);
      else released.set(shard, [topic]);
    }

    return released;
  }

  clear(): void {
    for (const shard of this.shards) shard.clear();
    this.owner.clear();
  }
}

/** One venue status for N shard sockets: any `down` wins, all `connected` is connected. */
export function aggregateShardState(
  states: readonly VenueConnectionState[],
): VenueConnectionState {
  if (states.length === 0) return "down";
  if (states.some((state) => state === "down")) return "down";
  if (states.every((state) => state === "connected")) return "connected";
  return "reconnecting";
}

/**
 * Drains queued control frames at a fixed rate. Paradex closes a socket with
 * 4032 "inbound queue full" when ~100 subscribe frames arrive within a second.
 */
export class PacedSender<T> {
  private queue: T[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly send: (message: T) => void,
    private readonly perTick: number,
    private readonly tickMs: number,
  ) {}

  get pending(): number {
    return this.queue.length;
  }

  enqueue(messages: Iterable<T>): void {
    for (const message of messages) this.queue.push(message);
    if (this.queue.length === 0 || this.timer != null) return;
    this.drain();
    if (this.queue.length > 0) {
      this.timer = setInterval(() => this.drain(), this.tickMs);
    }
  }

  /** Drops queued messages matching `predicate` (e.g. a subscribe superseded by an unsubscribe). */
  remove(predicate: (message: T) => boolean): void {
    this.queue = this.queue.filter((message) => !predicate(message));
  }

  clear(): void {
    this.queue = [];
    if (this.timer != null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private drain(): void {
    for (let i = 0; i < this.perTick && this.queue.length > 0; i++) {
      this.send(this.queue.shift()!);
    }
    if (this.queue.length === 0 && this.timer != null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
