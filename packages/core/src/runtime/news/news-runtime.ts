import { z } from 'zod';
import type { NewsObservation } from '@oggregator/protocol';

const RawTweetSchema = z.object({
  id: z.string().min(1).max(256),
  text: z.string(),
  url: z.string(),
  source: z.string(),
  handle: z.string().nullable().optional(),
  ruleTag: z.string().nullable().optional(),
  timestamp: z.number().int().nonnegative(),
  classification: z.enum(['GOOD', 'BAD']).optional(),
  createdAt: z.string().datetime().optional(),
  headlineTimestamp: z.string().optional(),
});
const RawNewsResponseSchema = z.object({
  count: z.number().int().nonnegative(),
  tweets: z.array(RawTweetSchema).max(200),
});

export interface NewsItem {
  id: string;
  text: string;
  url: string;
  source: string;
  handle: string | null;
  ruleTag: string | null;
  timestamp: number;
  classification: 'GOOD' | 'BAD';
  createdAt: string;
}

export interface NewsArchiveSink {
  recent(limit: number): NewsItem[];
  record(items: NewsItem[]): void;
}

export interface NewsRuntimeOptions {
  baseUrl: string;
  secret: string;
  pollIntervalMs?: number;
  cacheCap?: number;
  fetchImpl?: typeof fetch;
  archive?: NewsArchiveSink;
  log?: { warn: (...a: unknown[]) => void; info: (...a: unknown[]) => void };
  delivery?: { record(items: NewsObservation[], options?: { backfill?: boolean }): void };
  requestTimeoutMs?: number;
}

const DEFAULT_POLL_MS = 15_000;
const DEFAULT_CACHE_CAP = 200;
// Upstream returns its newest N regardless of `since` and caps N at 200, so the first poll
// after a restart asks for everything it has to close the gap in the archive.
const BACKFILL_LIMIT = 200;
const MAX_BACKOFF_MS = 60_000;

export class NewsRuntime {
  private readonly baseUrl: string;
  private readonly secret: string;
  private readonly pollIntervalMs: number;
  private readonly cacheCap: number;
  private readonly fetchImpl: typeof fetch;
  private readonly log: NewsRuntimeOptions['log'];
  private readonly archive: NewsArchiveSink | undefined;
  private readonly delivery: NewsRuntimeOptions['delivery'];
  private readonly requestTimeoutMs: number;
  private abortController: AbortController | null = null;
  private lastAttemptAt: number | null = null;
  private consecutiveErrors = 0;
  private lastError: string | null = null;
  private saturatedPolls = 0;

  private items: NewsItem[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private backoffMs = 0;
  errors = 0;
  private lastSuccessAt: number | null = null;
  private unclassifiedSince: number | null = null;

  constructor(opts: NewsRuntimeOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.secret = opts.secret;
    this.pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_MS;
    this.cacheCap = opts.cacheCap ?? DEFAULT_CACHE_CAP;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.log = opts.log;
    this.archive = opts.archive;
    this.delivery = opts.delivery;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 10_000;
  }

  async start(): Promise<void> {
    this.stopped = false;
    if (this.archive) this.items = this.archive.recent(this.cacheCap);
    await this.poll();
    this.scheduleNext();
  }

  dispose(): void {
    this.stopped = true;
    this.abortController?.abort();
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  isReady(): boolean {
    return (
      this.lastSuccessAt !== null &&
      Date.now() - this.lastSuccessAt <= Math.max(60_000, this.pollIntervalMs * 3)
    );
  }

  // Upstream keeps serving tweets when its classifier is down (e.g. provider quota hit), just
  // without `classification`, so a successful poll can still mean nothing will ever be shown.
  isClassifying(): boolean {
    return this.unclassifiedSince === null;
  }

  getUnclassifiedSince(): number | null {
    return this.unclassifiedSince;
  }

  getHealth() {
    return {
      ready: this.isReady(),
      lastAttemptAt: this.lastAttemptAt,
      lastSuccessAt: this.lastSuccessAt,
      lastSuccessAgeMs: this.lastSuccessAt === null ? null : Date.now() - this.lastSuccessAt,
      pollIntervalMs: this.pollIntervalMs,
      consecutiveErrors: this.consecutiveErrors,
      errors: this.errors,
      lastError: this.lastError,
      saturatedPolls: this.saturatedPolls,
      unclassifiedSince: this.unclassifiedSince,
      upstreamLimit: BACKFILL_LIMIT,
      delivery: 'polled-latest-window' as const,
      completeHistoryGuaranteed: false,
    };
  }

  getItems({ limit, since }: { limit?: number; since?: number } = {}): NewsItem[] {
    const cap = Math.min(this.cacheCap, Math.max(1, limit ?? 50));
    let result = this.items;
    if (since !== undefined) {
      result = result.filter((i) => i.timestamp > since);
    }
    return result.slice(0, cap);
  }

  private scheduleNext(): void {
    if (this.stopped) return;
    const delay = this.backoffMs > 0 ? this.backoffMs : this.pollIntervalMs;
    this.timer = setTimeout(() => {
      void this.poll().finally(() => this.scheduleNext());
    }, delay);
    this.timer.unref?.();
  }

  private async poll(): Promise<void> {
    this.lastAttemptAt = Date.now();
    let stage = 'upstream-request';
    try {
      const url = new URL(`${this.baseUrl}/feed/${this.secret}/twitter`);
      url.searchParams.set('limit', String(BACKFILL_LIMIT));

      this.abortController = new AbortController();
      const timeout = setTimeout(() => this.abortController?.abort(), this.requestTimeoutMs);
      let json: unknown;
      try {
        const res = await this.fetchImpl(url.toString(), { signal: this.abortController.signal });
        if (!res.ok) throw new Error(`upstream ${res.status}`);
        json = await res.json();
      } finally {
        clearTimeout(timeout);
        this.abortController = null;
      }
      stage = 'upstream-payload';
      const result = RawNewsResponseSchema.safeParse(json);
      if (!result.success) throw new Error('bad payload shape');
      const parsed = result.data;
      if (parsed.tweets.length === BACKFILL_LIMIT) this.saturatedPolls++;
      stage = 'delivery-persistence';
      this.delivery?.record(
        parsed.tweets.map((t) => ({
          id: t.id,
          text: t.text,
          url: t.url,
          source: t.source,
          handle: t.handle ?? null,
          ruleTag: t.ruleTag ?? null,
          timestamp: t.timestamp,
          classification: t.classification ?? 'unclassified',
          upstreamCreatedAt: t.createdAt ?? null,
          upstreamHeadlineTimestamp: t.headlineTimestamp ?? null,
        })),
        { backfill: this.lastSuccessAt === null },
      );

      this.trackClassification(parsed.tweets);

      const fresh: NewsItem[] = [];
      for (const t of parsed.tweets) {
        if (t.classification !== 'GOOD') continue;
        fresh.push({
          id: t.id,
          text: t.text,
          url: t.url,
          source: t.source,
          handle: t.handle ?? null,
          ruleTag: t.ruleTag ?? null,
          timestamp: t.timestamp,
          classification: 'GOOD',
          createdAt: t.createdAt ?? new Date(t.timestamp).toISOString(),
        });
      }

      if (this.archive && fresh.length > 0) {
        try {
          this.archive.record(fresh);
        } catch (err: unknown) {
          this.log?.warn?.({ err: String(err) }, 'news archive record failed');
        }
      }

      if (fresh.length > 0) {
        const seen = new Set(this.items.map((i) => i.id));
        const dedup = fresh.filter((i) => !seen.has(i.id));
        const merged = [...dedup, ...this.items]
          .sort((a, b) => b.timestamp - a.timestamp)
          .slice(0, this.cacheCap);
        this.items = merged;
      }

      this.backoffMs = 0;
      this.lastSuccessAt = Date.now();
      this.consecutiveErrors = 0;
      this.lastError = null;
    } catch {
      this.errors++;
      this.consecutiveErrors++;
      this.lastError = stage;
      this.backoffMs =
        this.backoffMs === 0 ? this.pollIntervalMs : Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
      this.log?.warn?.(
        { stage, errors: this.errors, consecutiveErrors: this.consecutiveErrors },
        'news feed poll or delivery persistence failed',
      );
    }
  }

  private trackClassification(tweets: z.infer<typeof RawTweetSchema>[]): void {
    if (tweets.length === 0) return;
    const classified = tweets.some((t) => t.classification !== undefined);
    if (classified) {
      if (this.unclassifiedSince !== null) {
        this.log?.info?.(
          { unclassifiedForMs: Date.now() - this.unclassifiedSince },
          'news feed classification recovered',
        );
        this.unclassifiedSince = null;
      }
      return;
    }
    if (this.unclassifiedSince === null) {
      this.unclassifiedSince = Date.now();
      this.log?.warn?.(
        { tweets: tweets.length },
        'news feed returning unclassified tweets; upstream classifier down, nothing will be shown',
      );
    }
  }
}
