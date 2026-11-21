import type {
  BotDepthQuery,
  BotDepthResponse,
  VenueId,
  VenueExecutionQuote,
} from '@oggregator/protocol';
import { BotDepthResponseSchema } from '@oggregator/protocol';
import { fetchPublicDepth as deribit } from '../../feeds/deribit/public-depth.js';
import { fetchPublicDepth as okx } from '../../feeds/okx/public-depth.js';
import { fetchPublicDepth as bybit } from '../../feeds/bybit/public-depth.js';
import { fetchPublicDepth as binance } from '../../feeds/binance/public-depth.js';
import { fetchPublicDepth as coincall } from '../../feeds/coincall/public-depth.js';
import { fetchPublicDepth as gateio } from '../../feeds/gateio/public-depth.js';
import { fetchPublicDepth as paradex } from '../../feeds/paradex/public-depth.js';
import { fetchPublicDepth as thalex } from '../../feeds/thalex/public-depth.js';
import { DerivePublicDepth } from '../../feeds/derive/public-depth.js';
import {
  PublicDepthError,
  type NativeDepthSnapshot,
  type PublicDepthFetcher,
} from '../../feeds/shared/public-depth.js';

const providers = { deribit, okx, bybit, binance, coincall, gateio, paradex, thalex };
export interface DepthContractContext {
  execution: VenueExecutionQuote;
  underlyingPriceUsd: number | null;
  asOfMs: number | null;
}
export interface PublicDepthOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
  provider?: Partial<Record<VenueId, PublicDepthFetcher>>;
  derive?: Pick<DerivePublicDepth, 'snapshot' | 'dispose'>;
}

export function normalizePublicDepth(
  native: NativeDepthSnapshot,
  query: BotDepthQuery,
  context: DepthContractContext,
  now: number,
): BotDepthResponse {
  const receivedAt = native.receivedAt ?? now;
  const requestedAt = native.requestedAt ?? receivedAt;
  const contract = context.execution;
  if (contract.exchangeSymbol !== query.instrument) throw new PublicDepthError('invalid-book');
  const nativePriceCurrency = native.priceCurrency ?? contract.settleCurrency;
  const reference = native.referencePriceUsd ?? context.underlyingPriceUsd;
  const referencePriceUsd =
    reference != null && Number.isFinite(reference) && reference > 0 ? reference : null;
  const referenceAsOfMs =
    native.referencePriceUsd != null ? (native.exchangeTs ?? receivedAt) : context.asOfMs;
  const multiplier = contract.contractMultiplierBase;
  if (!(Number.isFinite(multiplier) && multiplier > 0)) throw new PublicDepthError('invalid-book');
  const priceFactor = contract.inverse ? referencePriceUsd : 1;
  const normalize = (levels: NativeDepthSnapshot['bids'], direction: 'bid' | 'ask') => {
    if (levels.some((level) => level.some((value) => !Number.isFinite(value) || value < 0)))
      throw new PublicDepthError('invalid-book');
    if (new Set(levels.map((level) => level[0])).size !== levels.length)
      throw new PublicDepthError('invalid-book');
    return levels
      .filter(([price, size]) => price > 0 && size > 0)
      .map(([nativePrice, nativeQuantity]) => {
        if (![nativePrice, nativeQuantity].every((value) => Number.isFinite(value) && value > 0))
          throw new PublicDepthError('invalid-book');
        return {
          nativePrice,
          nativeQuantity,
          priceUsdPerBase:
            priceFactor != null && priceFactor > 0 ? nativePrice * priceFactor : null,
          quantityBase: nativeQuantity * multiplier,
        };
      })
      .sort((a, b) =>
        direction === 'bid' ? b.nativePrice - a.nativePrice : a.nativePrice - b.nativePrice,
      )
      .slice(0, query.levels);
  };
  const bids = normalize(native.bids, 'bid');
  const asks = normalize(native.asks, 'ask');
  const crossed = bids[0] != null && asks[0] != null && bids[0].nativePrice >= asks[0].nativePrice;
  const bookState = crossed
    ? 'crossed'
    : bids.length && asks.length
      ? 'two-sided'
      : bids.length || asks.length
        ? 'one-sided'
        : 'empty';
  const bookAgeMs = Math.max(0, now - receivedAt);
  const reasons: string[] = [];
  const warnings = ['snapshot-only', 'depth-limited'];
  if (receivedAt > now + 1000 || (native.exchangeTs != null && native.exchangeTs > now + 1000))
    reasons.push('future-timestamp');
  if (bookAgeMs > query.maxAgeMs) reasons.push('stale-receive-time');
  if (
    native.exchangeTimestampBasis === 'generation' &&
    native.exchangeTs != null &&
    now - native.exchangeTs > query.maxAgeMs
  )
    reasons.push('stale-exchange-time');
  if (bookState !== 'two-sided')
    reasons.push(bookState === 'crossed' ? 'crossed-book' : 'missing-two-sided-depth');
  if (contract.expiryTs == null || contract.expiryTs <= now)
    reasons.push('missing-or-expired-expiry');
  if (
    contract.inverse &&
    (!(referencePriceUsd != null && referencePriceUsd > 0) ||
      referenceAsOfMs == null ||
      now - referenceAsOfMs > query.maxAgeMs ||
      referenceAsOfMs > now + 1000)
  )
    reasons.push('missing-or-stale-conversion-reference');
  const priceBasis = contract.inverse
    ? 'inverse-index'
    : nativePriceCurrency === 'USD'
      ? 'usd'
      : 'stablecoin-parity';
  if (priceBasis === 'stablecoin-parity') warnings.push('stablecoin-usd-parity-assumption');
  if (native.exchangeTs == null) warnings.push('exchange-timestamp-unavailable');
  if (query.venue === 'thalex') warnings.push('occasional-rest-snapshot-max-five-levels');
  return BotDepthResponseSchema.parse({
    venue: query.venue,
    underlying: query.underlying,
    expiry: query.expiry,
    instrument: query.instrument,
    generatedAt: now,
    requestedAt,
    receivedAt,
    bookAgeMs,
    source: query.venue === 'derive' ? 'websocket-snapshot' : 'rest',
    access: query.access,
    dataMode: 'snapshot',
    exchangeTs: native.exchangeTs,
    exchangeTimestampBasis: native.exchangeTimestampBasis,
    lastChangeAt: native.lastChangeAt,
    sequence: native.sequence,
    connectionGeneration: native.connectionGeneration ?? null,
    sequenceContinuityVerified: false,
    sourceMaxLevels: native.sourceMaxLevels,
    requestedLevels: query.levels,
    depthLimited: true,
    bookState,
    dataReady: reasons.length === 0,
    reasons,
    warnings,
    nativePriceCurrency,
    nativeQuantityUnit: 'venue-native',
    normalization: {
      priceUnit: 'USD per base unit',
      quantityUnit: 'base',
      priceBasis,
      referencePriceUsd: contract.inverse ? referencePriceUsd : null,
      referenceAsOfMs: contract.inverse ? referenceAsOfMs : null,
    },
    contract,
    bids,
    asks,
  });
}

export class PublicDepthRuntime {
  private readonly now: () => number;
  private readonly fetchImpl: typeof fetch;
  private readonly derive: Pick<DerivePublicDepth, 'snapshot' | 'dispose'>;
  private readonly abort = new AbortController();
  private readonly cache = new Map<string, { at: number; data: NativeDepthSnapshot }>();
  private readonly inFlight = new Map<string, Promise<NativeDepthSnapshot>>();
  private readonly failures = new Map<string, { until: number; error: PublicDepthError }>();
  private requests = 0;
  private errors = 0;
  private coalesced = 0;

  constructor(private readonly options: PublicDepthOptions = {}) {
    this.now = options.now ?? Date.now;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.derive = options.derive ?? new DerivePublicDepth(this.now);
  }

  getHealth() {
    return {
      enabled: !this.abort.signal.aborted,
      cacheEntries: this.cache.size,
      inFlight: this.inFlight.size,
      requests: this.requests,
      errors: this.errors,
      coalesced: this.coalesced,
      mode: 'public-snapshots' as const,
      supportedVenues: [...Object.keys(providers), 'derive'],
      thalexCacheMs: 30000,
    };
  }

  async snapshot(query: BotDepthQuery, context: DepthContractContext): Promise<BotDepthResponse> {
    if (this.abort.signal.aborted) throw new PublicDepthError('disposed');
    if (query.access !== 'api' && query.venue !== 'paradex')
      throw new PublicDepthError('unsupported-access');
    const key = `${query.venue}:${query.instrument}:${query.access}`;
    const cached = this.cache.get(key);
    const ttl = query.venue === 'thalex' ? 30000 : 1000;
    if (cached && this.now() - cached.at < ttl)
      return normalizePublicDepth(cached.data, query, context, this.now());
    let pending = this.inFlight.get(key);
    if (pending) this.coalesced++;
    else {
      const failure = this.failures.get(key);
      if (failure && this.now() < failure.until) throw failure.error;
      if (this.inFlight.size >= 8) throw new PublicDepthError('capacity');
      this.requests++;
      pending = this.fetchNative(query)
        .then((data) => {
          if (this.cache.size >= 200) this.cache.delete(this.cache.keys().next().value!);
          this.cache.set(key, { at: this.now(), data });
          this.failures.delete(key);
          return data;
        })
        .catch((error: unknown) => {
          this.errors++;
          const failure =
            error instanceof PublicDepthError ? error : new PublicDepthError('invalid-book');
          if (this.failures.size >= 200) this.failures.delete(this.failures.keys().next().value!);
          this.failures.set(key, { error: failure, until: this.now() + 5000 });
          throw failure;
        })
        .finally(() => {
          this.inFlight.delete(key);
        });
      this.inFlight.set(key, pending);
    }
    return normalizePublicDepth(await pending, query, context, this.now());
  }

  private async fetchNative(query: BotDepthQuery): Promise<NativeDepthSnapshot> {
    if (query.venue === 'derive' && !this.options.provider?.derive)
      return this.derive.snapshot(query.instrument);
    const provider =
      this.options.provider?.[query.venue] ?? providers[query.venue as keyof typeof providers];
    if (!provider) throw new PublicDepthError('invalid-book');
    const requestedAt = this.now();
    const data = await provider(
      query.instrument,
      async (url) => {
        try {
          const response = await this.fetchImpl(url, {
            signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(5000)]),
          });
          if (!response.ok) throw new PublicDepthError('upstream-http');
          const body = await response.text();
          if (body.length > 1_000_000) throw new PublicDepthError('invalid-book');
          return JSON.parse(body) as unknown;
        } catch (error) {
          if (error instanceof PublicDepthError) throw error;
          throw new PublicDepthError('upstream-timeout');
        }
      },
      query.access,
    );
    return { ...data, requestedAt, receivedAt: this.now() };
  }

  async dispose(): Promise<void> {
    this.abort.abort();
    await this.derive.dispose();
    await Promise.allSettled(this.inFlight.values());
    this.cache.clear();
  }
}
