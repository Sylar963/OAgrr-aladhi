import type { VenueId } from '../../types/common.js';
import { feedLogger } from '../../utils/logger.js';
import { JsonRpcWsClient } from '../shared/jsonrpc-client.js';
import { PARADEX_WS_URL } from '../shared/endpoints.js';
import { SdkBaseAdapter, type CachedInstrument } from '../shared/sdk-base.js';
import { parseParadexSummary } from './codec.js';
import { deriveParadexHealth } from './health.js';
import { PARADEX_SUMMARY_CHANNEL } from './planner.js';
import { fetchParadexMarkets, fetchParadexServerTime, fetchParadexSummaryAll } from './rest.js';
import { buildParadexQuote, paradexInstrumentDetails } from './state.js';

const log = feedLogger('paradex');
const INSTRUMENT_REFRESH_INTERVAL_MS = 10 * 60_000;
const HEALTH_CHECK_INTERVAL_MS = 60_000;

/**
 * Paradex adapter using direct JSON-RPC over WebSocket.
 *
 * Closest in shape to Derive (JSON-RPC, fraction IV, no app heartbeat), with one
 * structural difference: Paradex exposes a single bare `markets_summary` firehose
 * that carries the whole chain in one channel, instead of per-instrument ticker
 * subscriptions. The subscribe param is `{ channel }` (singular) — not the shared
 * client's `{ channels: [...] }` — so we (re)subscribe the single firehose BY HAND
 * in the `onStatusChange('connected')` callback, never via `rpc.subscribe()`.
 *
 * Pushes arrive on channel `markets_summary` (bare) keyed by `data.symbol`; the
 * codec routes on `channel.startsWith('markets_summary')` so it is robust whether
 * the venue ever switches to `markets_summary.{symbol}`. USDC-settled, all linear,
 * IV already in fraction form.
 */
export class ParadexWsAdapter extends SdkBaseAdapter {
  readonly venue: VenueId = 'paradex';

  private rpc!: JsonRpcWsClient;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;

  protected initClients(): void {
    if (this.rpc) return;
    this.rpc = new JsonRpcWsClient(PARADEX_WS_URL, 'paradex-ws', {
      heartbeatIntervalSec: 30,
      requestTimeoutMs: 30_000,
      subscribeMethod: 'subscribe',
      unsubscribeMethod: 'unsubscribe',
      onStatusChange: (state) => {
        this.emitStatus(
          state === 'connected' ? 'connected' : state === 'down' ? 'down' : 'reconnecting',
        );
        // Paradex subscribe param is { channel } (singular) — not the shared
        // client's { channels: [...] } — so we (re)subscribe the single bare
        // firehose by hand on every (re)connect.
        if (state === 'connected') {
          void this.rpc
            .call('subscribe', { channel: PARADEX_SUMMARY_CHANNEL })
            .catch((err: unknown) =>
              log.warn({ err: String(err) }, 'markets_summary subscribe failed'),
            );
        }
      },
    });

    this.rpc.onSubscription((channel, data) => {
      if (channel.startsWith('markets_summary')) this.handleSummary(data);
    });
  }

  protected override getFeedConnectionSnapshot() {
    return {
      connected: this.rpc.isConnected,
      lastActivityAt: this.rpc.lastActivityAtMs || this.rpc.connectedAtMs,
    };
  }

  override getFeedDiagnostics() {
    return {
      connected: this.rpc.isConnected,
      lastActivityAt: this.rpc.lastActivityAtMs || this.rpc.connectedAtMs,
      reconnectAttempts: this.rpc.reconnectAttemptsCount,
      rateLimitUntil: this.rpc.rateLimitUntilMs,
    };
  }

  protected override restartFeedFromWatchdog(): void {
    this.rpc.terminate();
  }

  // ─── instrument loading ───────────────────────────────────────

  protected async fetchInstruments(): Promise<CachedInstrument[]> {
    await this.rpc.connect();

    const markets = await fetchParadexMarkets();
    const instruments: CachedInstrument[] = [];
    for (const market of markets) {
      const inst = this.parseInstrument(market);
      if (inst) instruments.push(inst);
    }
    log.info({ count: instruments.length }, 'loaded paradex option instruments');

    const optionSymbols = new Set(instruments.map((i) => i.exchangeSymbol));
    await this.seedQuotes(optionSymbols);

    this.refreshTimer = setInterval(
      () => void this.refreshInstruments(),
      INSTRUMENT_REFRESH_INTERVAL_MS,
    );
    this.healthTimer = setInterval(() => void this.refreshHealth(), HEALTH_CHECK_INTERVAL_MS);
    void this.refreshHealth();

    return instruments;
  }

  private parseInstrument(market: unknown): CachedInstrument | null {
    const parsed = market as Parameters<typeof paradexInstrumentDetails>[0];
    const d = paradexInstrumentDetails(parsed);
    if (d == null) return null;

    const expiry = this.parseExpiry(d.expiryRaw);
    return {
      symbol: this.buildCanonicalSymbol(d.base, d.settle, expiry, d.strike, d.right),
      exchangeSymbol: parsed.symbol,
      base: d.base,
      quote: 'USD',
      settle: d.settle,
      expiry,
      expirationTimestamp: d.expirationTimestampMs,
      strike: d.strike,
      right: d.right,
      inverse: false,
      contractSize: 1,
      contractValueCurrency: d.base,
      tickSize: this.safeNum(d.tickRaw),
      minQty: this.safeNum(d.stepRaw),
      makerFee: this.safeNum(d.makerFeeRaw),
      takerFee: this.safeNum(d.takerFeeRaw),
    };
  }

  private async seedQuotes(optionSymbols: Set<string>): Promise<void> {
    try {
      const summaries = await fetchParadexSummaryAll();
      let n = 0;
      for (const s of summaries) {
        if (!optionSymbols.has(s.symbol)) continue;
        this.quoteStore.set(
          s.symbol,
          buildParadexQuote(
            s,
            (v) => this.safeNum(v),
            (v) => this.positiveOrNull(v),
          ),
        );
        n++;
      }
      log.info({ count: n }, 'seeded paradex quotes from REST summary');
    } catch (err: unknown) {
      log.warn({ err: String(err) }, 'paradex summary seed failed');
    }
  }

  // ─── WebSocket subscriptions ──────────────────────────────────

  protected async subscribeChain(): Promise<void> {
    await this.rpc.connect();
  }

  protected async unsubscribeAll(): Promise<void> {
    await this.rpc.unsubscribeAll();
  }

  // ─── WS message handlers ─────────────────────────────────────

  private handleSummary(data: unknown): void {
    const summary = parseParadexSummary(data);
    if (summary == null) return;
    if (!this.instrumentMap.has(summary.symbol)) return; // ignore perps/spot + unknown
    const quote = buildParadexQuote(
      summary,
      (v) => this.safeNum(v),
      (v) => this.positiveOrNull(v),
    );
    this.emitQuoteUpdate(summary.symbol, quote);
  }

  private async refreshInstruments(): Promise<void> {
    try {
      const markets = await fetchParadexMarkets();
      let added = 0;
      for (const market of markets) {
        const inst = this.parseInstrument(market);
        if (!inst || this.instrumentMap.has(inst.exchangeSymbol)) continue;
        this.instruments.push(inst);
        this.instrumentMap.set(inst.exchangeSymbol, inst);
        this.symbolIndex.set(inst.symbol, inst.exchangeSymbol);
        added++;
      }
      if (added > 0) log.info({ added }, 'paradex new instruments from refresh');
    } catch (err: unknown) {
      log.warn({ err: String(err) }, 'paradex instrument refresh failed');
    }
  }

  private async refreshHealth(): Promise<void> {
    const serverTime = await fetchParadexServerTime();
    const health = deriveParadexHealth({ serverTime, wsConnected: this.rpc.isConnected });
    this.emitStatus(health.status, health.message);
  }

  override async dispose(): Promise<void> {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
    await this.unsubscribeAll();
    await this.rpc?.disconnect();
  }
}
