import type {
  EquityHistoryPoint,
  PositionLeg,
  ParadexAccountSummary,
  ParadexRfq,
  LinearPosition,
  ExchangePortfolioTrade,
} from '@oggregator/protocol';

import { feedLogger } from '../../utils/logger.js';
import { PARADEX_REST_BASE_URL, PARADEX_TESTNET_REST_BASE_URL } from '../shared/endpoints.js';
import { paradexAccountHistoryToPoints, paradexPositionsToLegs, paradexPositionsToLinear, paradexFillToTrade } from './codec.js';
import {
  ParadexAccountHistorySchema,
  ParadexPositionsResponseSchema,
  ParadexAccountSchema,
  ParadexRfqListSchema,
  ParadexRfqBboSchema,
  ParadexFillsResponseSchema,
} from './types.js';

export interface ParadexPrivateCreds {
  readonlyToken: string;
  env?: 'prod' | 'test';
}

export type ParadexPositionsListener = (legs: PositionLeg[], linear: LinearPosition[]) => void;

export class ParadexAuthError extends Error {
  constructor(status: number) {
    super(`Paradex rejected the read-only token (HTTP ${status})`);
    this.name = 'ParadexAuthError';
  }
}

// Readonly tokens are documented for GET requests only, so positions are polled over
// REST rather than streamed from the private WebSocket.
const POSITIONS_REFRESH_MS = 15_000;

export class ParadexPrivateClient {
  private readonly listeners = new Set<ParadexPositionsListener>();
  private latestLegs: PositionLeg[] = [];
  private latestLinear: LinearPosition[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private refreshInFlight: Promise<void> | null = null;
  private disposed = false;
  private readonly abortController = new AbortController();
  private readonly log = feedLogger('paradex-private');

  constructor(
    private readonly creds: ParadexPrivateCreds,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async start(): Promise<void> {
    await this.fetchPositions();
    if (this.disposed) return;
    this.timer = setInterval(() => void this.refresh(), POSITIONS_REFRESH_MS);
    this.timer.unref?.();
  }

  subscribe(listener: ParadexPositionsListener): () => void {
    this.listeners.add(listener);
    if (this.latestLegs.length > 0) {
      try {
        listener(this.latestLegs, this.latestLinear);
      } catch {}
    }
    return () => {
      this.listeners.delete(listener);
    };
  }

  getLatestLegs(): PositionLeg[] {
    return [...this.latestLegs];
  }

  async fetchOptionTrades(fromMs: number): Promise<ExchangePortfolioTrade[]> {
    const trades = new Map<string, ExchangePortfolioTrade>();
    const cursors = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const params = new URLSearchParams({ asset_kind: 'OPTION', page_size: '1000', start_at: String(fromMs) });
      if (cursor != null) params.set('cursor', cursor);
      const result = ParadexFillsResponseSchema.parse(await this.read(`/fills?${params}`));
      for (const fill of result.results) {
        const trade = paradexFillToTrade(fill);
        if (trade != null) trades.set(trade.tradeId, trade);
      }
      if (!result.next) return [...trades.values()];
      if (cursors.has(result.next)) throw new Error('Paradex fill history repeated a cursor');
      cursors.add(result.next);
      cursor = result.next;
    }
    throw new Error('Paradex fill history exceeded the page limit');
  }

  async fetchAccountSummary(): Promise<ParadexAccountSummary> {
    const account = ParadexAccountSchema.parse(await this.read('/account'));
    return {
      ...(account.account != null && { venueAccount: account.account }),
      equityUsd: account.account_value,
      freeCollateralUsd: account.free_collateral,
      initialMarginUsd: account.initial_margin_requirement,
      maintenanceMarginUsd: account.maintenance_margin_requirement,
      settlementAsset: account.settlement_asset ?? null,
      updatedAt: account.updated_at,
      fetchedAt: Date.now(),
      totalCollateralUsd: account.total_collateral,
      environment: this.creds.env ?? 'prod',
    };
  }

  async fetchOpenRfqs(
    underlying: string,
    cursor?: string,
  ): Promise<{
    next: string | null;
    rfqs: ParadexRfq[];
    fetchedAt: number;
  }> {
    const params = new URLSearchParams({ state: 'OPEN', page_size: '100' });
    if (cursor != null) params.set('cursor', cursor);
    const page = ParadexRfqListSchema.parse(await this.read(`/rfqs?${params}`));
    const matches = page.results.filter(
      (rfq) =>
        rfq.state === 'OPEN' && rfq.legs.some((leg) => leg.market.startsWith(`${underlying}-`)),
    );
    const rfqs: ParadexRfq[] = [];
    // Keep per-account BBO reads bounded; each RFQ has its own endpoint.
    for (let offset = 0; offset < matches.length; offset += 4) {
      const batch = await Promise.all(
        matches.slice(offset, offset + 4).map(async (rfq) => {
          let quote: ParadexRfq['quote'] = null;
          if (rfq.expires_at == null || rfq.expires_at > Date.now()) {
            try {
              const bbo = ParadexRfqBboSchema.parse(
                await this.read(`/rfqs/${encodeURIComponent(rfq.id)}/bbo`),
              );
              if (bbo.rfq_id != null && bbo.rfq_id !== rfq.id) throw new Error('RFQ id mismatch');
              quote = {
                bidPrice: bbo.best_bid_price,
                askPrice: bbo.best_ask_price,
                bidQuantity: bbo.best_bid_quantity,
                askQuantity: bbo.best_ask_quantity,
                markPrice: bbo.mark_price,
                createdAt: bbo.created_at,
                fetchedAt: Date.now(),
              };
            } catch (error) {
              if (error instanceof ParadexAuthError) throw error;
              this.log.warn({ rfqId: rfq.id, err: String(error) }, 'paradex RFQ quote unavailable');
            }
          }
          return {
            id: rfq.id,
            state: rfq.state,
            quantity: rfq.quantity,
            filledQuantity: rfq.filled_quantity,
            createdAt: rfq.created_at,
            expiresAt: rfq.expires_at,
            legs: rfq.legs.map((leg) => ({
              market: leg.market,
              side: leg.side,
              ratio: leg.ratio,
              price: leg.price,
            })),
            quote,
          };
        }),
      );
      rfqs.push(...batch);
    }
    return { next: page.next ?? null, rfqs, fetchedAt: Date.now() };
  }

  private async read(path: string): Promise<unknown> {
    const baseUrl = this.creds.env === 'test' ? PARADEX_TESTNET_REST_BASE_URL : PARADEX_REST_BASE_URL;
    const res = await this.fetchImpl(`${baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${this.creds.readonlyToken}` },
      signal: AbortSignal.any([this.abortController.signal, AbortSignal.timeout(10_000)]),
    });
    if (res.status === 401 || res.status === 403) throw new ParadexAuthError(res.status);
    if (!res.ok) throw new Error(`Paradex read HTTP ${res.status}`);
    return res.json();
  }

  async fetchEquityHistory(fromMs: number): Promise<EquityHistoryPoint[]> {
    // Paradex requires a resolution even though its OpenAPI spec omits it.
    // Its portfolio uses alltime for windows longer than 800 hours.
    const parsed = ParadexAccountHistorySchema.parse(
      await this.read('/account/history?type=value&resolution=alltime'),
    );
    return paradexAccountHistoryToPoints(parsed).filter((point) => point.ts >= fromMs);
  }

  async fetchPnlHistory(fromMs: number): Promise<Array<{ ts: number; pnlUsd: number }>> {
    const history = ParadexAccountHistorySchema.parse(
      await this.read('/account/history?type=pnl&resolution=alltime'),
    );
    return paradexAccountHistoryToPoints(history)
      .filter((point) => point.ts >= fromMs)
      .map((point) => ({ ts: point.ts, pnlUsd: point.equityUsd }));
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.stopPolling();
    this.abortController.abort();
    this.listeners.clear();
  }

  private stopPolling(): void {
    if (this.timer != null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private refresh(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.refreshInFlight != null) return this.refreshInFlight;
    this.refreshInFlight = this.fetchPositions()
      .catch((err: unknown) => {
        if (this.disposed) return;
        if (err instanceof ParadexAuthError) {
          this.log.warn({ err: err.message }, 'paradex read-only token rejected; polling stopped');
          this.stopPolling();
          return;
        }
        this.log.warn({ err: String(err) }, 'paradex positions refresh failed');
      })
      .finally(() => {
        this.refreshInFlight = null;
      });
    return this.refreshInFlight;
  }

  private async fetchPositions(): Promise<void> {
    const parsed = ParadexPositionsResponseSchema.safeParse(await this.read('/positions'));
    if (this.disposed) return;
    if (!parsed.success) throw new Error(`Paradex positions parse failed: ${parsed.error.message}`);
    const legs = paradexPositionsToLegs(parsed.data.results);
    const linear = paradexPositionsToLinear(parsed.data.results);
    this.latestLegs = legs;
    this.latestLinear = linear;
    for (const listener of this.listeners) {
      try {
        listener(legs, linear);
      } catch {}
    }
  }
}
