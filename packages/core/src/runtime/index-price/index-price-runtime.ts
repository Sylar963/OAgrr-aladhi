import type WebSocket from 'ws';
import {
  GATEIO_OPTIONS_UNDERLYINGS,
  GATEIO_REST_BASE_URL,
} from '../../feeds/shared/endpoints.js';
import { TopicWsClient } from '../../feeds/shared/topic-ws-client.js';
import { buildBsInfoSubscribeMessage } from '../../feeds/coincall/planner.js';
import { CoincallBsInfoMessageSchema } from '../../feeds/coincall/types.js';
import { buildSignedWsUrl } from '../../feeds/coincall/ws-client.js';
import { fromGateioRestBase } from '../../feeds/gateio/aliases.js';
import { GateioUnderlyingsResponseSchema } from '../../feeds/gateio/types.js';
import { fetchCoincallInstrumentsForBase } from '../trades/trade-runtime.js';
import type { VenueId } from '../../types/common.js';
import { feedLogger } from '../../utils/logger.js';

const log = feedLogger('index-price');

const GATEIO_POLL_INTERVAL_MS = 30 * 1000;
const GATEIO_REQUEST_TIMEOUT_MS = 10 * 1000;
const COINCALL_HEARTBEAT_INTERVAL_MS = 15 * 1000;
// bsInfo pushes roughly every second per symbol, so a minute of silence is a dead socket.
const COINCALL_IDLE_TIMEOUT_MS = 60 * 1000;

export interface IndexPriceRuntimeStartOptions {
  gateio?: boolean;
  coincallUnderlyings?: string[];
}

/**
 * Per-venue index price tracker used as the third tier in mapLiveTrade's
 * referencePriceUsd lookup, behind trade.indexPrice (1) and Binance USDT
 * SpotRuntime (2). Covers underlyings with no Binance USDT spot pair —
 * commodity bases like XTI/CL, and Coincall-only altcoins like MNT/LIT/KAS.
 */
export class IndexPriceRuntime {
  private prices = new Map<string, number>();
  private gateioTimer: ReturnType<typeof setInterval> | null = null;
  private coincallClient: TopicWsClient | null = null;
  private coincallSymbolByUnderlying = new Map<string, string>();
  private coincallUnderlyingBySymbol = new Map<string, string>();
  private started = false;

  async start(opts: IndexPriceRuntimeStartOptions = {}): Promise<void> {
    // Idempotent: a second start() would leak timers and double-open the WS.
    if (this.started) return;
    this.started = true;

    if (opts.gateio) {
      void this.refreshGateio();
      this.gateioTimer = setInterval(() => void this.refreshGateio(), GATEIO_POLL_INTERVAL_MS);
    }

    const coincallUnderlyings = opts.coincallUnderlyings ?? [];
    if (coincallUnderlyings.length > 0 && hasCoincallCredentials()) {
      await this.resolveCoincallSymbols(coincallUnderlyings);
      if (this.coincallSymbolByUnderlying.size > 0) {
        this.connectCoincall();
      }
    }
  }

  get(venue: VenueId, underlying: string): number | null {
    return this.prices.get(`${venue}:${underlying.toUpperCase()}`) ?? null;
  }

  dispose(): void {
    this.started = false;
    if (this.gateioTimer != null) {
      clearInterval(this.gateioTimer);
      this.gateioTimer = null;
    }
    if (this.coincallClient != null) {
      void this.coincallClient.disconnect();
      this.coincallClient = null;
    }
    this.prices.clear();
    this.coincallSymbolByUnderlying.clear();
    this.coincallUnderlyingBySymbol.clear();
  }

  private async refreshGateio(): Promise<void> {
    try {
      const url = new URL(GATEIO_OPTIONS_UNDERLYINGS, GATEIO_REST_BASE_URL);
      const res = await fetch(url, { signal: AbortSignal.timeout(GATEIO_REQUEST_TIMEOUT_MS) });
      if (!res.ok) {
        log.warn({ status: res.status }, 'gateio underlyings refresh failed');
        return;
      }
      const data = (await res.clone().json()) as unknown;
      const parsed = GateioUnderlyingsResponseSchema.safeParse(data);
      if (!parsed.success) {
        log.warn('gateio underlyings response failed schema');
        return;
      }
      for (const item of parsed.data) {
        const parts = item.name.split('_');
        const rawBase = parts[0];
        if (!rawBase) continue;
        const publicBase = fromGateioRestBase(rawBase);
        const price = Number(item.index_price);
        if (!Number.isFinite(price) || price <= 0) continue;
        this.prices.set(`gateio:${publicBase}`, price);
      }
    } catch (err: unknown) {
      log.warn({ err: String(err) }, 'gateio underlyings refresh error');
    }
  }

  private async resolveCoincallSymbols(underlyings: string[]): Promise<void> {
    // Coincall's bsInfo channel is per-symbol but `up` (underlying price) is
    // invariant across symbols of the same base. Pick the first active symbol
    // per base — any will do.
    for (const u of underlyings) {
      const base = u.toUpperCase();
      try {
        const symbols = await fetchCoincallInstrumentsForBase(base);
        const sample = symbols[0];
        if (sample) {
          this.coincallSymbolByUnderlying.set(base, sample);
          this.coincallUnderlyingBySymbol.set(sample, base);
        }
      } catch (err) {
        log.warn({ underlying: base, err: String(err) }, 'coincall symbol resolution failed');
      }
    }
  }

  private connectCoincall(): void {
    if (!this.started || this.coincallSymbolByUnderlying.size === 0) return;
    if (this.coincallClient != null) return;

    const client = new TopicWsClient(() => buildSignedWsUrl(), 'coincall-index', {
      pingIntervalMs: COINCALL_HEARTBEAT_INTERVAL_MS,
      pingMessage: { action: 'heartbeat' },
      idleTimeoutMs: COINCALL_IDLE_TIMEOUT_MS,
      getReplayMessages: () =>
        [...this.coincallSymbolByUnderlying.values()].map((symbol) =>
          buildBsInfoSubscribeMessage(symbol),
        ),
      onStatusChange: (state) => {
        if (state !== 'connected') return;
        log.info(
          { underlyings: [...this.coincallSymbolByUnderlying.keys()].join(',') },
          'coincall index ws connected',
        );
      },
      onMessage: (raw: WebSocket.RawData) => this.handleCoincallMessage(raw),
      onError: (err) => log.warn({ err: err.message }, 'coincall index ws error'),
    });
    this.coincallClient = client;
    // Failures before open are retried by the client's own close→reconnect path.
    client.connect().catch(() => {});
  }

  private handleCoincallMessage(raw: WebSocket.RawData): void {
    try {
      const json = JSON.parse(raw.toString());
      const parsed = CoincallBsInfoMessageSchema.safeParse(json);
      if (!parsed.success) return;
      const symbol = parsed.data.d.s;
      const up = parsed.data.d.up;
      if (up == null) return;
      const underlying = this.coincallUnderlyingBySymbol.get(symbol);
      if (underlying == null) return;
      this.prices.set(`coincall:${underlying}`, up);
    } catch {
      // Ignore malformed frames.
    }
  }
}

function hasCoincallCredentials(): boolean {
  return Boolean(process.env['COINCALL_API_KEY'] && process.env['COINCALL_API_SECRET']);
}
