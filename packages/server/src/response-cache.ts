interface CacheEntry<T> {
  expiresAt: number;
  promise: Promise<T>;
}

export class ResponseCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 256,
  ) {}

  get(key: string, load: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const existing = this.entries.get(key);
    if (existing != null && existing.expiresAt > now) return existing.promise;

    let promise: Promise<T>;
    promise = load().catch((error: unknown) => {
      if (this.entries.get(key)?.promise === promise) this.entries.delete(key);
      throw error;
    });

    this.entries.set(key, { expiresAt: now + this.ttlMs, promise });
    this.prune(now);
    return promise;
  }

  clear(): void {
    this.entries.clear();
  }

  private prune(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }

    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest == null) return;
      this.entries.delete(oldest);
    }
  }
}
