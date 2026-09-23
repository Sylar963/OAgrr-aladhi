import { z } from 'zod';

import {
  BlockFlowResponseSchema,
  ChainResponseSchema,
  type CompactChain,
  type CompactSurface,
  compactBlockFlow,
  compactChain,
  compactGex,
  compactIvHistory,
  compactSurface,
  GexResponseSchema,
  IvHistoryResponseSchema,
  round,
  SurfaceResponseSchema,
} from './market-data-compaction.js';

export type MarketInjector = (path: string) => Promise<{ statusCode: number; body: unknown }>;

export type MarketReadResult<T> = { ok: true; data: T } | { ok: false; error: string };

const ExpiriesResponseSchema = z.object({
  underlying: z.string(),
  expiries: z.array(z.string()),
  timestamps: z
    .array(z.object({ expiry: z.string(), expiryTs: z.number().nullable() }))
    .optional(),
});

const UnderlyingsResponseSchema = z.object({ underlyings: z.array(z.string()) }).passthrough();

const StatsResponseSchema = z
  .object({
    spot: z
      .object({
        price: z.number().nullable().optional(),
        change24hPct: z.number().nullable().optional(),
        high24h: z.number().nullable().optional(),
        low24h: z.number().nullable().optional(),
      })
      .nullable()
      .optional(),
    dvol: z
      .object({
        current: z.number().nullable().optional(),
        ivp: z.number().nullable().optional(),
        ivChange1d: z.number().nullable().optional(),
        high52w: z.number().nullable().optional(),
        low52w: z.number().nullable().optional(),
      })
      .nullable()
      .optional(),
  })
  .passthrough();

const DEFAULT_TIMEOUT_MS = 5_000;

export const CHAIN_UNITS_NOTE =
  'Prices are USD per 1 contract of underlying. Best bid/ask are the highest bid and lowest ask across fresh venue quotes. IV, delta, gamma, theta and vega are medians of venue-reported values; theta is venue-reported USD per day and vega venue-reported USD per 1 vol point. Open interest and volume are summed contracts across venues.';

function normalizeUnderlying(underlying: string): string {
  return underlying.trim().toUpperCase();
}

export class AssistantMarketDataReader {
  private injector: MarketInjector | null = null;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  bind(injector: MarketInjector): void {
    this.injector = injector;
  }

  private async get<T>(path: string, schema: z.ZodType<T>): Promise<MarketReadResult<T>> {
    const injector = this.injector;
    if (!injector) return { ok: false, error: 'Market data is not wired yet.' };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await Promise.race([
        injector(path),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('timeout')), this.timeoutMs);
        }),
      ]);
      if (response.statusCode !== 200) {
        const message =
          response.body && typeof response.body === 'object' && 'message' in response.body
            ? String((response.body as { message: unknown }).message)
            : `HTTP ${response.statusCode}`;
        return { ok: false, error: `Oggregator returned ${message} for ${path.split('?')[0]}.` };
      }
      const parsed = schema.safeParse(response.body);
      if (!parsed.success) return { ok: false, error: `Unexpected payload from ${path.split('?')[0]}.` };
      return { ok: true, data: parsed.data };
    } catch (error) {
      const reason = error instanceof Error && error.message === 'timeout' ? 'timed out' : 'failed';
      return { ok: false, error: `Request to ${path.split('?')[0]} ${reason}.` };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async listUnderlyings(): Promise<MarketReadResult<{ underlyings: string[] }>> {
    const result = await this.get('/api/underlyings', UnderlyingsResponseSchema);
    return result.ok ? { ok: true, data: { underlyings: result.data.underlyings } } : result;
  }

  async listExpiries(
    underlying: string,
  ): Promise<
    MarketReadResult<{
      underlying: string;
      expiries: Array<{ expiry: string; expiryIso: string | null; daysToExpiry: number | null }>;
    }>
  > {
    const u = normalizeUnderlying(underlying);
    const result = await this.get(
      `/api/expiries?underlying=${encodeURIComponent(u)}`,
      ExpiriesResponseSchema,
    );
    if (!result.ok) return result;
    const timestamps = new Map(
      (result.data.timestamps ?? []).map((row) => [row.expiry, row.expiryTs]),
    );
    const now = this.now();
    return {
      ok: true,
      data: {
        underlying: result.data.underlying,
        expiries: result.data.expiries.map((expiry) => {
          const ts = timestamps.get(expiry) ?? Date.parse(`${expiry}T08:00:00.000Z`);
          return {
            expiry,
            expiryIso: Number.isFinite(ts) ? new Date(ts).toISOString() : null,
            daysToExpiry: Number.isFinite(ts) ? round((ts - now) / 86_400_000, 2) : null,
          };
        }),
      },
    };
  }

  async marketOverview(underlying: string): Promise<MarketReadResult<Record<string, unknown>>> {
    const u = encodeURIComponent(normalizeUnderlying(underlying));
    const [context, stats] = await Promise.all([
      this.get(`/api/alpha/market-context?underlying=${u}`, z.record(z.string(), z.unknown())),
      this.get(`/api/stats?underlying=${u}`, StatsResponseSchema),
    ]);
    if (!context.ok && !stats.ok) return context;
    return {
      ok: true,
      data: {
        underlying: normalizeUnderlying(underlying),
        spot24h: stats.ok ? (stats.data.spot ?? null) : null,
        dvol: stats.ok ? (stats.data.dvol ?? null) : null,
        volatilityContext: context.ok ? context.data : null,
        notes: [
          'IV, DVOL and realized volatility are fractions (0.36 = 36%).',
          'vrp = implied minus realized volatility; descriptive, not a proven edge.',
          ...(context.ok ? [] : [`Volatility context unavailable: ${context.error}`]),
          ...(stats.ok ? [] : [`Spot/DVOL stats unavailable: ${stats.error}`]),
        ],
      },
    };
  }

  async optionChain(
    underlying: string,
    expiry: string,
    options: {
      minStrike?: number | undefined;
      maxStrike?: number | undefined;
      side?: 'call' | 'put' | 'both' | undefined;
      includeStrikes?: number[] | undefined;
    } = {},
  ): Promise<MarketReadResult<CompactChain & { units: string }>> {
    const u = encodeURIComponent(normalizeUnderlying(underlying));
    const result = await this.get(
      `/api/chains?underlying=${u}&expiry=${encodeURIComponent(expiry)}`,
      ChainResponseSchema,
    );
    if (!result.ok) return result;
    return {
      ok: true,
      data: {
        ...compactChain(result.data, { ...options, nowMs: this.now() }),
        units: CHAIN_UNITS_NOTE,
      },
    };
  }

  async volSurface(
    underlying: string,
    options: { includeVenueAtm: boolean; maxExpiries?: number },
  ): Promise<MarketReadResult<CompactSurface>> {
    const u = encodeURIComponent(normalizeUnderlying(underlying));
    const result = await this.get(`/api/surface?underlying=${u}`, SurfaceResponseSchema);
    return result.ok ? { ok: true, data: compactSurface(result.data, options) } : result;
  }

  async ivHistory(
    underlying: string,
    windowDays: 30 | 90,
  ): Promise<MarketReadResult<ReturnType<typeof compactIvHistory>>> {
    const u = encodeURIComponent(normalizeUnderlying(underlying));
    const result = await this.get(
      `/api/iv-history?underlying=${u}&window=${windowDays}d`,
      IvHistoryResponseSchema,
    );
    return result.ok ? { ok: true, data: compactIvHistory(result.data) } : result;
  }

  async gammaExposure(
    underlying: string,
  ): Promise<MarketReadResult<ReturnType<typeof compactGex>>> {
    const u = encodeURIComponent(normalizeUnderlying(underlying));
    const result = await this.get(`/api/gex-all-expiries?underlying=${u}`, GexResponseSchema);
    return result.ok ? { ok: true, data: compactGex(result.data) } : result;
  }

  async blockFlow(
    underlying: string,
    limit: number,
  ): Promise<MarketReadResult<ReturnType<typeof compactBlockFlow>>> {
    const u = encodeURIComponent(normalizeUnderlying(underlying));
    const result = await this.get(
      `/api/block-flow?underlying=${u}&limit=${limit}`,
      BlockFlowResponseSchema,
    );
    return result.ok ? { ok: true, data: compactBlockFlow(result.data) } : result;
  }
}
