import { z } from 'zod';
// ── Venue primitives ──────────────────────────────────────────────
export const VENUE_IDS = ['deribit', 'okx', 'bybit', 'binance', 'derive', 'coincall', 'thalex', 'tastytrade'];
export const VenueIdSchema = z.enum(VENUE_IDS);
// ── Subscription request ──────────────────────────────────────────
export const WsSubscriptionRequestSchema = z.object({
    underlying: z.string().min(1),
    expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    venues: z.array(VenueIdSchema).min(1),
});
// ── Snapshot metadata ─────────────────────────────────────────────
export const SnapshotMetaSchema = z.object({
    generatedAt: z.number(),
    maxQuoteTs: z.number(),
    staleMs: z.number(),
});
// ── Venue failure ─────────────────────────────────────────────────
export const VenueFailureSchema = z.object({
    venue: VenueIdSchema,
    reason: z.string(),
});
// ── Client → Server ───────────────────────────────────────────────
export const ClientWsMessageSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('subscribe'),
        subscriptionId: z.string().min(1),
        request: WsSubscriptionRequestSchema,
    }),
    z.object({
        type: z.literal('unsubscribe'),
    }),
]);
// ── Server → Client ──────────────────────────────────────────────
export const VenueConnectionStateSchema = z.enum([
    'connected',
    'polling',
    'reconnecting',
    'degraded',
    'down',
]);
const VenueStateSchema = VenueConnectionStateSchema;
const NullableNumberSchema = z.number().nullable();
const EstimatedFeesSchema = z.object({
    maker: z.number(),
    taker: z.number(),
});
const VenueQuoteSchema = z.object({
    bid: NullableNumberSchema,
    ask: NullableNumberSchema,
    mid: NullableNumberSchema,
    bidSize: NullableNumberSchema,
    askSize: NullableNumberSchema,
    markIv: NullableNumberSchema,
    bidIv: NullableNumberSchema,
    askIv: NullableNumberSchema,
    delta: NullableNumberSchema,
    gamma: NullableNumberSchema,
    theta: NullableNumberSchema,
    vega: NullableNumberSchema,
    spreadPct: NullableNumberSchema,
    totalCost: NullableNumberSchema,
    estimatedFees: EstimatedFeesSchema.nullable(),
    openInterest: NullableNumberSchema,
    volume24h: NullableNumberSchema,
    openInterestUsd: NullableNumberSchema,
    volume24hUsd: NullableNumberSchema,
});
const EnrichedSideSchema = z.object({
    venues: z.record(z.string(), VenueQuoteSchema),
    bestIv: NullableNumberSchema,
    bestVenue: VenueIdSchema.nullable(),
});
const EnrichedStrikeSchema = z.object({
    strike: z.number(),
    call: EnrichedSideSchema,
    put: EnrichedSideSchema,
});
const GexStrikeSchema = z.object({
    strike: z.number(),
    gexUsdMillions: z.number(),
});
const ChainStatsSchema = z.object({
    forwardPriceUsd: NullableNumberSchema,
    indexPriceUsd: NullableNumberSchema,
    basisPct: NullableNumberSchema,
    atmStrike: NullableNumberSchema,
    atmIv: NullableNumberSchema,
    putCallOiRatio: NullableNumberSchema,
    totalOiUsd: NullableNumberSchema,
    skew25d: NullableNumberSchema,
    bfly25d: NullableNumberSchema,
});
export const EnrichedChainResponseSchema = z.object({
    underlying: z.string(),
    expiry: z.string(),
    expiryTs: z.number().nullable(),
    dte: z.number(),
    stats: ChainStatsSchema,
    strikes: z.array(EnrichedStrikeSchema),
    gex: z.array(GexStrikeSchema),
});
const PremiumValueSchema = z.object({
    raw: z.number().nullable().optional(),
    rawCurrency: z.string().optional(),
    usd: z.number().nullable().optional(),
});
export const VenueDeltaSchema = z.object({
    venue: VenueIdSchema,
    symbol: z.string(),
    ts: z.number(),
    quote: z
        .object({
        bid: PremiumValueSchema.optional(),
        ask: PremiumValueSchema.optional(),
        mark: PremiumValueSchema.optional(),
        last: PremiumValueSchema.nullable().optional(),
        bidSize: NullableNumberSchema.optional(),
        askSize: NullableNumberSchema.optional(),
        underlyingPriceUsd: NullableNumberSchema.optional(),
        indexPriceUsd: NullableNumberSchema.optional(),
        volume24h: NullableNumberSchema.optional(),
        openInterest: NullableNumberSchema.optional(),
        openInterestUsd: NullableNumberSchema.optional(),
        volume24hUsd: NullableNumberSchema.optional(),
        estimatedFees: EstimatedFeesSchema.nullable().optional(),
        timestamp: NullableNumberSchema.optional(),
        source: z.string().optional(),
    })
        .partial()
        .optional(),
    greeks: z
        .object({
        delta: NullableNumberSchema.optional(),
        gamma: NullableNumberSchema.optional(),
        theta: NullableNumberSchema.optional(),
        vega: NullableNumberSchema.optional(),
        rho: NullableNumberSchema.optional(),
        markIv: NullableNumberSchema.optional(),
        bidIv: NullableNumberSchema.optional(),
        askIv: NullableNumberSchema.optional(),
    })
        .partial()
        .optional(),
});
export const DeltaPatchSchema = z.object({
    stats: ChainStatsSchema,
    strikes: z.array(EnrichedStrikeSchema),
    gex: z.array(GexStrikeSchema),
});
export const ServerWsMessageSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('subscribed'),
        subscriptionId: z.string(),
        request: WsSubscriptionRequestSchema,
        serverTime: z.number(),
        failedVenues: z.array(VenueFailureSchema).optional(),
    }),
    z.object({
        type: z.literal('snapshot'),
        subscriptionId: z.string(),
        seq: z.number(),
        request: WsSubscriptionRequestSchema,
        meta: SnapshotMetaSchema,
        data: EnrichedChainResponseSchema,
    }),
    z.object({
        type: z.literal('delta'),
        subscriptionId: z.string(),
        seq: z.number(),
        request: WsSubscriptionRequestSchema,
        meta: SnapshotMetaSchema,
        deltas: z.array(VenueDeltaSchema),
        patch: DeltaPatchSchema,
    }),
    z.object({
        type: z.literal('status'),
        subscriptionId: z.string(),
        venue: VenueIdSchema,
        state: VenueStateSchema,
        ts: z.number(),
        message: z.string().optional(),
    }),
    z.object({
        type: z.literal('error'),
        subscriptionId: z.string().nullable(),
        code: z.string(),
        message: z.string(),
        retryable: z.boolean(),
    }),
]);
//# sourceMappingURL=ws.js.map