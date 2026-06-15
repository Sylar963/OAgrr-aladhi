import { z } from 'zod';
export declare const VENUE_IDS: readonly ["deribit", "okx", "bybit", "binance", "derive", "coincall", "thalex", "tastytrade"];
export type VenueId = (typeof VENUE_IDS)[number];
export declare const VenueIdSchema: z.ZodEnum<["deribit", "okx", "bybit", "binance", "derive", "coincall", "thalex", "tastytrade"]>;
export type VenueConnectionState = 'connected' | 'polling' | 'reconnecting' | 'degraded' | 'down';
/** Browser-side socket lifecycle — distinct from venue health */
export type WsConnectionState = 'connecting' | 'live' | 'reconnecting' | 'stale' | 'error' | 'closed';
export declare const WsSubscriptionRequestSchema: z.ZodObject<{
    underlying: z.ZodString;
    expiry: z.ZodString;
    venues: z.ZodArray<z.ZodEnum<["deribit", "okx", "bybit", "binance", "derive", "coincall", "thalex", "tastytrade"]>, "many">;
}, "strip", z.ZodTypeAny, {
    underlying: string;
    expiry: string;
    venues: ("deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade")[];
}, {
    underlying: string;
    expiry: string;
    venues: ("deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade")[];
}>;
export type WsSubscriptionRequest = z.infer<typeof WsSubscriptionRequestSchema>;
export declare const SnapshotMetaSchema: z.ZodObject<{
    generatedAt: z.ZodNumber;
    maxQuoteTs: z.ZodNumber;
    staleMs: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    generatedAt: number;
    maxQuoteTs: number;
    staleMs: number;
}, {
    generatedAt: number;
    maxQuoteTs: number;
    staleMs: number;
}>;
export type SnapshotMeta = z.infer<typeof SnapshotMetaSchema>;
export declare const VenueFailureSchema: z.ZodObject<{
    venue: z.ZodEnum<["deribit", "okx", "bybit", "binance", "derive", "coincall", "thalex", "tastytrade"]>;
    reason: z.ZodString;
}, "strip", z.ZodTypeAny, {
    venue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade";
    reason: string;
}, {
    venue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade";
    reason: string;
}>;
export type VenueFailure = z.infer<typeof VenueFailureSchema>;
export declare const ClientWsMessageSchema: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
    type: z.ZodLiteral<"subscribe">;
    subscriptionId: z.ZodString;
    request: z.ZodObject<{
        underlying: z.ZodString;
        expiry: z.ZodString;
        venues: z.ZodArray<z.ZodEnum<["deribit", "okx", "bybit", "binance", "derive", "coincall", "thalex", "tastytrade"]>, "many">;
    }, "strip", z.ZodTypeAny, {
        underlying: string;
        expiry: string;
        venues: ("deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade")[];
    }, {
        underlying: string;
        expiry: string;
        venues: ("deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade")[];
    }>;
}, "strip", z.ZodTypeAny, {
    type: "subscribe";
    subscriptionId: string;
    request: {
        underlying: string;
        expiry: string;
        venues: ("deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade")[];
    };
}, {
    type: "subscribe";
    subscriptionId: string;
    request: {
        underlying: string;
        expiry: string;
        venues: ("deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade")[];
    };
}>, z.ZodObject<{
    type: z.ZodLiteral<"unsubscribe">;
}, "strip", z.ZodTypeAny, {
    type: "unsubscribe";
}, {
    type: "unsubscribe";
}>]>;
export type ClientWsMessage = z.infer<typeof ClientWsMessageSchema>;
export declare const VenueConnectionStateSchema: z.ZodEnum<["connected", "polling", "reconnecting", "degraded", "down"]>;
export interface EstimatedFees {
    maker: number;
    taker: number;
}
export interface VenueQuote {
    bid: number | null;
    ask: number | null;
    mid: number | null;
    bidSize: number | null;
    askSize: number | null;
    markIv: number | null;
    bidIv: number | null;
    askIv: number | null;
    delta: number | null;
    gamma: number | null;
    theta: number | null;
    vega: number | null;
    spreadPct: number | null;
    totalCost: number | null;
    estimatedFees: EstimatedFees | null;
    openInterest: number | null;
    volume24h: number | null;
    openInterestUsd: number | null;
    volume24hUsd: number | null;
}
export interface EnrichedSide {
    venues: Partial<Record<VenueId, VenueQuote>>;
    bestIv: number | null;
    bestVenue: VenueId | null;
}
export interface EnrichedStrike {
    strike: number;
    call: EnrichedSide;
    put: EnrichedSide;
}
export interface GexStrike {
    strike: number;
    gexUsdMillions: number;
}
export interface ChainStats {
    forwardPriceUsd: number | null;
    indexPriceUsd: number | null;
    basisPct: number | null;
    atmStrike: number | null;
    atmIv: number | null;
    putCallOiRatio: number | null;
    totalOiUsd: number | null;
    skew25d: number | null;
    bfly25d: number | null;
}
export interface EnrichedChainResponse {
    underlying: string;
    expiry: string;
    expiryTs: number | null;
    dte: number;
    stats: ChainStats;
    strikes: EnrichedStrike[];
    gex: GexStrike[];
}
export interface VenueDelta {
    venue: VenueId;
    symbol: string;
    ts: number;
    quote?: {
        bid?: {
            raw?: number | null;
            rawCurrency?: string;
            usd?: number | null;
        };
        ask?: {
            raw?: number | null;
            rawCurrency?: string;
            usd?: number | null;
        };
        mark?: {
            raw?: number | null;
            rawCurrency?: string;
            usd?: number | null;
        };
        last?: {
            raw?: number | null;
            rawCurrency?: string;
            usd?: number | null;
        } | null;
        bidSize?: number | null;
        askSize?: number | null;
        underlyingPriceUsd?: number | null;
        indexPriceUsd?: number | null;
        volume24h?: number | null;
        openInterest?: number | null;
        openInterestUsd?: number | null;
        volume24hUsd?: number | null;
        estimatedFees?: EstimatedFees | null;
        timestamp?: number | null;
        source?: string;
    };
    greeks?: {
        delta?: number | null;
        gamma?: number | null;
        theta?: number | null;
        vega?: number | null;
        rho?: number | null;
        markIv?: number | null;
        bidIv?: number | null;
        askIv?: number | null;
    };
}
export declare const EnrichedChainResponseSchema: z.ZodObject<{
    underlying: z.ZodString;
    expiry: z.ZodString;
    expiryTs: z.ZodNullable<z.ZodNumber>;
    dte: z.ZodNumber;
    stats: z.ZodObject<{
        forwardPriceUsd: z.ZodNullable<z.ZodNumber>;
        indexPriceUsd: z.ZodNullable<z.ZodNumber>;
        basisPct: z.ZodNullable<z.ZodNumber>;
        atmStrike: z.ZodNullable<z.ZodNumber>;
        atmIv: z.ZodNullable<z.ZodNumber>;
        putCallOiRatio: z.ZodNullable<z.ZodNumber>;
        totalOiUsd: z.ZodNullable<z.ZodNumber>;
        skew25d: z.ZodNullable<z.ZodNumber>;
        bfly25d: z.ZodNullable<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        forwardPriceUsd: number | null;
        indexPriceUsd: number | null;
        basisPct: number | null;
        atmStrike: number | null;
        atmIv: number | null;
        putCallOiRatio: number | null;
        totalOiUsd: number | null;
        skew25d: number | null;
        bfly25d: number | null;
    }, {
        forwardPriceUsd: number | null;
        indexPriceUsd: number | null;
        basisPct: number | null;
        atmStrike: number | null;
        atmIv: number | null;
        putCallOiRatio: number | null;
        totalOiUsd: number | null;
        skew25d: number | null;
        bfly25d: number | null;
    }>;
    strikes: z.ZodArray<z.ZodObject<{
        strike: z.ZodNumber;
        call: z.ZodObject<{
            venues: z.ZodRecord<z.ZodString, z.ZodObject<{
                bid: z.ZodNullable<z.ZodNumber>;
                ask: z.ZodNullable<z.ZodNumber>;
                mid: z.ZodNullable<z.ZodNumber>;
                bidSize: z.ZodNullable<z.ZodNumber>;
                askSize: z.ZodNullable<z.ZodNumber>;
                markIv: z.ZodNullable<z.ZodNumber>;
                bidIv: z.ZodNullable<z.ZodNumber>;
                askIv: z.ZodNullable<z.ZodNumber>;
                delta: z.ZodNullable<z.ZodNumber>;
                gamma: z.ZodNullable<z.ZodNumber>;
                theta: z.ZodNullable<z.ZodNumber>;
                vega: z.ZodNullable<z.ZodNumber>;
                spreadPct: z.ZodNullable<z.ZodNumber>;
                totalCost: z.ZodNullable<z.ZodNumber>;
                estimatedFees: z.ZodNullable<z.ZodObject<{
                    maker: z.ZodNumber;
                    taker: z.ZodNumber;
                }, "strip", z.ZodTypeAny, {
                    maker: number;
                    taker: number;
                }, {
                    maker: number;
                    taker: number;
                }>>;
                openInterest: z.ZodNullable<z.ZodNumber>;
                volume24h: z.ZodNullable<z.ZodNumber>;
                openInterestUsd: z.ZodNullable<z.ZodNumber>;
                volume24hUsd: z.ZodNullable<z.ZodNumber>;
            }, "strip", z.ZodTypeAny, {
                bid: number | null;
                ask: number | null;
                mid: number | null;
                bidSize: number | null;
                askSize: number | null;
                markIv: number | null;
                bidIv: number | null;
                askIv: number | null;
                delta: number | null;
                gamma: number | null;
                theta: number | null;
                vega: number | null;
                spreadPct: number | null;
                totalCost: number | null;
                estimatedFees: {
                    maker: number;
                    taker: number;
                } | null;
                openInterest: number | null;
                volume24h: number | null;
                openInterestUsd: number | null;
                volume24hUsd: number | null;
            }, {
                bid: number | null;
                ask: number | null;
                mid: number | null;
                bidSize: number | null;
                askSize: number | null;
                markIv: number | null;
                bidIv: number | null;
                askIv: number | null;
                delta: number | null;
                gamma: number | null;
                theta: number | null;
                vega: number | null;
                spreadPct: number | null;
                totalCost: number | null;
                estimatedFees: {
                    maker: number;
                    taker: number;
                } | null;
                openInterest: number | null;
                volume24h: number | null;
                openInterestUsd: number | null;
                volume24hUsd: number | null;
            }>>;
            bestIv: z.ZodNullable<z.ZodNumber>;
            bestVenue: z.ZodNullable<z.ZodEnum<["deribit", "okx", "bybit", "binance", "derive", "coincall", "thalex", "tastytrade"]>>;
        }, "strip", z.ZodTypeAny, {
            venues: Record<string, {
                bid: number | null;
                ask: number | null;
                mid: number | null;
                bidSize: number | null;
                askSize: number | null;
                markIv: number | null;
                bidIv: number | null;
                askIv: number | null;
                delta: number | null;
                gamma: number | null;
                theta: number | null;
                vega: number | null;
                spreadPct: number | null;
                totalCost: number | null;
                estimatedFees: {
                    maker: number;
                    taker: number;
                } | null;
                openInterest: number | null;
                volume24h: number | null;
                openInterestUsd: number | null;
                volume24hUsd: number | null;
            }>;
            bestIv: number | null;
            bestVenue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade" | null;
        }, {
            venues: Record<string, {
                bid: number | null;
                ask: number | null;
                mid: number | null;
                bidSize: number | null;
                askSize: number | null;
                markIv: number | null;
                bidIv: number | null;
                askIv: number | null;
                delta: number | null;
                gamma: number | null;
                theta: number | null;
                vega: number | null;
                spreadPct: number | null;
                totalCost: number | null;
                estimatedFees: {
                    maker: number;
                    taker: number;
                } | null;
                openInterest: number | null;
                volume24h: number | null;
                openInterestUsd: number | null;
                volume24hUsd: number | null;
            }>;
            bestIv: number | null;
            bestVenue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade" | null;
        }>;
        put: z.ZodObject<{
            venues: z.ZodRecord<z.ZodString, z.ZodObject<{
                bid: z.ZodNullable<z.ZodNumber>;
                ask: z.ZodNullable<z.ZodNumber>;
                mid: z.ZodNullable<z.ZodNumber>;
                bidSize: z.ZodNullable<z.ZodNumber>;
                askSize: z.ZodNullable<z.ZodNumber>;
                markIv: z.ZodNullable<z.ZodNumber>;
                bidIv: z.ZodNullable<z.ZodNumber>;
                askIv: z.ZodNullable<z.ZodNumber>;
                delta: z.ZodNullable<z.ZodNumber>;
                gamma: z.ZodNullable<z.ZodNumber>;
                theta: z.ZodNullable<z.ZodNumber>;
                vega: z.ZodNullable<z.ZodNumber>;
                spreadPct: z.ZodNullable<z.ZodNumber>;
                totalCost: z.ZodNullable<z.ZodNumber>;
                estimatedFees: z.ZodNullable<z.ZodObject<{
                    maker: z.ZodNumber;
                    taker: z.ZodNumber;
                }, "strip", z.ZodTypeAny, {
                    maker: number;
                    taker: number;
                }, {
                    maker: number;
                    taker: number;
                }>>;
                openInterest: z.ZodNullable<z.ZodNumber>;
                volume24h: z.ZodNullable<z.ZodNumber>;
                openInterestUsd: z.ZodNullable<z.ZodNumber>;
                volume24hUsd: z.ZodNullable<z.ZodNumber>;
            }, "strip", z.ZodTypeAny, {
                bid: number | null;
                ask: number | null;
                mid: number | null;
                bidSize: number | null;
                askSize: number | null;
                markIv: number | null;
                bidIv: number | null;
                askIv: number | null;
                delta: number | null;
                gamma: number | null;
                theta: number | null;
                vega: number | null;
                spreadPct: number | null;
                totalCost: number | null;
                estimatedFees: {
                    maker: number;
                    taker: number;
                } | null;
                openInterest: number | null;
                volume24h: number | null;
                openInterestUsd: number | null;
                volume24hUsd: number | null;
            }, {
                bid: number | null;
                ask: number | null;
                mid: number | null;
                bidSize: number | null;
                askSize: number | null;
                markIv: number | null;
                bidIv: number | null;
                askIv: number | null;
                delta: number | null;
                gamma: number | null;
                theta: number | null;
                vega: number | null;
                spreadPct: number | null;
                totalCost: number | null;
                estimatedFees: {
                    maker: number;
                    taker: number;
                } | null;
                openInterest: number | null;
                volume24h: number | null;
                openInterestUsd: number | null;
                volume24hUsd: number | null;
            }>>;
            bestIv: z.ZodNullable<z.ZodNumber>;
            bestVenue: z.ZodNullable<z.ZodEnum<["deribit", "okx", "bybit", "binance", "derive", "coincall", "thalex", "tastytrade"]>>;
        }, "strip", z.ZodTypeAny, {
            venues: Record<string, {
                bid: number | null;
                ask: number | null;
                mid: number | null;
                bidSize: number | null;
                askSize: number | null;
                markIv: number | null;
                bidIv: number | null;
                askIv: number | null;
                delta: number | null;
                gamma: number | null;
                theta: number | null;
                vega: number | null;
                spreadPct: number | null;
                totalCost: number | null;
                estimatedFees: {
                    maker: number;
                    taker: number;
                } | null;
                openInterest: number | null;
                volume24h: number | null;
                openInterestUsd: number | null;
                volume24hUsd: number | null;
            }>;
            bestIv: number | null;
            bestVenue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade" | null;
        }, {
            venues: Record<string, {
                bid: number | null;
                ask: number | null;
                mid: number | null;
                bidSize: number | null;
                askSize: number | null;
                markIv: number | null;
                bidIv: number | null;
                askIv: number | null;
                delta: number | null;
                gamma: number | null;
                theta: number | null;
                vega: number | null;
                spreadPct: number | null;
                totalCost: number | null;
                estimatedFees: {
                    maker: number;
                    taker: number;
                } | null;
                openInterest: number | null;
                volume24h: number | null;
                openInterestUsd: number | null;
                volume24hUsd: number | null;
            }>;
            bestIv: number | null;
            bestVenue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade" | null;
        }>;
    }, "strip", z.ZodTypeAny, {
        call: {
            venues: Record<string, {
                bid: number | null;
                ask: number | null;
                mid: number | null;
                bidSize: number | null;
                askSize: number | null;
                markIv: number | null;
                bidIv: number | null;
                askIv: number | null;
                delta: number | null;
                gamma: number | null;
                theta: number | null;
                vega: number | null;
                spreadPct: number | null;
                totalCost: number | null;
                estimatedFees: {
                    maker: number;
                    taker: number;
                } | null;
                openInterest: number | null;
                volume24h: number | null;
                openInterestUsd: number | null;
                volume24hUsd: number | null;
            }>;
            bestIv: number | null;
            bestVenue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade" | null;
        };
        put: {
            venues: Record<string, {
                bid: number | null;
                ask: number | null;
                mid: number | null;
                bidSize: number | null;
                askSize: number | null;
                markIv: number | null;
                bidIv: number | null;
                askIv: number | null;
                delta: number | null;
                gamma: number | null;
                theta: number | null;
                vega: number | null;
                spreadPct: number | null;
                totalCost: number | null;
                estimatedFees: {
                    maker: number;
                    taker: number;
                } | null;
                openInterest: number | null;
                volume24h: number | null;
                openInterestUsd: number | null;
                volume24hUsd: number | null;
            }>;
            bestIv: number | null;
            bestVenue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade" | null;
        };
        strike: number;
    }, {
        call: {
            venues: Record<string, {
                bid: number | null;
                ask: number | null;
                mid: number | null;
                bidSize: number | null;
                askSize: number | null;
                markIv: number | null;
                bidIv: number | null;
                askIv: number | null;
                delta: number | null;
                gamma: number | null;
                theta: number | null;
                vega: number | null;
                spreadPct: number | null;
                totalCost: number | null;
                estimatedFees: {
                    maker: number;
                    taker: number;
                } | null;
                openInterest: number | null;
                volume24h: number | null;
                openInterestUsd: number | null;
                volume24hUsd: number | null;
            }>;
            bestIv: number | null;
            bestVenue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade" | null;
        };
        put: {
            venues: Record<string, {
                bid: number | null;
                ask: number | null;
                mid: number | null;
                bidSize: number | null;
                askSize: number | null;
                markIv: number | null;
                bidIv: number | null;
                askIv: number | null;
                delta: number | null;
                gamma: number | null;
                theta: number | null;
                vega: number | null;
                spreadPct: number | null;
                totalCost: number | null;
                estimatedFees: {
                    maker: number;
                    taker: number;
                } | null;
                openInterest: number | null;
                volume24h: number | null;
                openInterestUsd: number | null;
                volume24hUsd: number | null;
            }>;
            bestIv: number | null;
            bestVenue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade" | null;
        };
        strike: number;
    }>, "many">;
    gex: z.ZodArray<z.ZodObject<{
        strike: z.ZodNumber;
        gexUsdMillions: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        strike: number;
        gexUsdMillions: number;
    }, {
        strike: number;
        gexUsdMillions: number;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    underlying: string;
    expiry: string;
    expiryTs: number | null;
    dte: number;
    stats: {
        forwardPriceUsd: number | null;
        indexPriceUsd: number | null;
        basisPct: number | null;
        atmStrike: number | null;
        atmIv: number | null;
        putCallOiRatio: number | null;
        totalOiUsd: number | null;
        skew25d: number | null;
        bfly25d: number | null;
    };
    strikes: {
        call: {
            venues: Record<string, {
                bid: number | null;
                ask: number | null;
                mid: number | null;
                bidSize: number | null;
                askSize: number | null;
                markIv: number | null;
                bidIv: number | null;
                askIv: number | null;
                delta: number | null;
                gamma: number | null;
                theta: number | null;
                vega: number | null;
                spreadPct: number | null;
                totalCost: number | null;
                estimatedFees: {
                    maker: number;
                    taker: number;
                } | null;
                openInterest: number | null;
                volume24h: number | null;
                openInterestUsd: number | null;
                volume24hUsd: number | null;
            }>;
            bestIv: number | null;
            bestVenue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade" | null;
        };
        put: {
            venues: Record<string, {
                bid: number | null;
                ask: number | null;
                mid: number | null;
                bidSize: number | null;
                askSize: number | null;
                markIv: number | null;
                bidIv: number | null;
                askIv: number | null;
                delta: number | null;
                gamma: number | null;
                theta: number | null;
                vega: number | null;
                spreadPct: number | null;
                totalCost: number | null;
                estimatedFees: {
                    maker: number;
                    taker: number;
                } | null;
                openInterest: number | null;
                volume24h: number | null;
                openInterestUsd: number | null;
                volume24hUsd: number | null;
            }>;
            bestIv: number | null;
            bestVenue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade" | null;
        };
        strike: number;
    }[];
    gex: {
        strike: number;
        gexUsdMillions: number;
    }[];
}, {
    underlying: string;
    expiry: string;
    expiryTs: number | null;
    dte: number;
    stats: {
        forwardPriceUsd: number | null;
        indexPriceUsd: number | null;
        basisPct: number | null;
        atmStrike: number | null;
        atmIv: number | null;
        putCallOiRatio: number | null;
        totalOiUsd: number | null;
        skew25d: number | null;
        bfly25d: number | null;
    };
    strikes: {
        call: {
            venues: Record<string, {
                bid: number | null;
                ask: number | null;
                mid: number | null;
                bidSize: number | null;
                askSize: number | null;
                markIv: number | null;
                bidIv: number | null;
                askIv: number | null;
                delta: number | null;
                gamma: number | null;
                theta: number | null;
                vega: number | null;
                spreadPct: number | null;
                totalCost: number | null;
                estimatedFees: {
                    maker: number;
                    taker: number;
                } | null;
                openInterest: number | null;
                volume24h: number | null;
                openInterestUsd: number | null;
                volume24hUsd: number | null;
            }>;
            bestIv: number | null;
            bestVenue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade" | null;
        };
        put: {
            venues: Record<string, {
                bid: number | null;
                ask: number | null;
                mid: number | null;
                bidSize: number | null;
                askSize: number | null;
                markIv: number | null;
                bidIv: number | null;
                askIv: number | null;
                delta: number | null;
                gamma: number | null;
                theta: number | null;
                vega: number | null;
                spreadPct: number | null;
                totalCost: number | null;
                estimatedFees: {
                    maker: number;
                    taker: number;
                } | null;
                openInterest: number | null;
                volume24h: number | null;
                openInterestUsd: number | null;
                volume24hUsd: number | null;
            }>;
            bestIv: number | null;
            bestVenue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade" | null;
        };
        strike: number;
    }[];
    gex: {
        strike: number;
        gexUsdMillions: number;
    }[];
}>;
export declare const VenueDeltaSchema: z.ZodObject<{
    venue: z.ZodEnum<["deribit", "okx", "bybit", "binance", "derive", "coincall", "thalex", "tastytrade"]>;
    symbol: z.ZodString;
    ts: z.ZodNumber;
    quote: z.ZodOptional<z.ZodObject<{
        bid: z.ZodOptional<z.ZodOptional<z.ZodObject<{
            raw: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            rawCurrency: z.ZodOptional<z.ZodString>;
            usd: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        }, "strip", z.ZodTypeAny, {
            raw?: number | null | undefined;
            rawCurrency?: string | undefined;
            usd?: number | null | undefined;
        }, {
            raw?: number | null | undefined;
            rawCurrency?: string | undefined;
            usd?: number | null | undefined;
        }>>>;
        ask: z.ZodOptional<z.ZodOptional<z.ZodObject<{
            raw: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            rawCurrency: z.ZodOptional<z.ZodString>;
            usd: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        }, "strip", z.ZodTypeAny, {
            raw?: number | null | undefined;
            rawCurrency?: string | undefined;
            usd?: number | null | undefined;
        }, {
            raw?: number | null | undefined;
            rawCurrency?: string | undefined;
            usd?: number | null | undefined;
        }>>>;
        mark: z.ZodOptional<z.ZodOptional<z.ZodObject<{
            raw: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            rawCurrency: z.ZodOptional<z.ZodString>;
            usd: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        }, "strip", z.ZodTypeAny, {
            raw?: number | null | undefined;
            rawCurrency?: string | undefined;
            usd?: number | null | undefined;
        }, {
            raw?: number | null | undefined;
            rawCurrency?: string | undefined;
            usd?: number | null | undefined;
        }>>>;
        last: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodObject<{
            raw: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            rawCurrency: z.ZodOptional<z.ZodString>;
            usd: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        }, "strip", z.ZodTypeAny, {
            raw?: number | null | undefined;
            rawCurrency?: string | undefined;
            usd?: number | null | undefined;
        }, {
            raw?: number | null | undefined;
            rawCurrency?: string | undefined;
            usd?: number | null | undefined;
        }>>>>;
        bidSize: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
        askSize: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
        underlyingPriceUsd: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
        indexPriceUsd: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
        volume24h: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
        openInterest: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
        openInterestUsd: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
        volume24hUsd: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
        estimatedFees: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodObject<{
            maker: z.ZodNumber;
            taker: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            maker: number;
            taker: number;
        }, {
            maker: number;
            taker: number;
        }>>>>;
        timestamp: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
        source: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        indexPriceUsd?: number | null | undefined;
        bid?: {
            raw?: number | null | undefined;
            rawCurrency?: string | undefined;
            usd?: number | null | undefined;
        } | undefined;
        ask?: {
            raw?: number | null | undefined;
            rawCurrency?: string | undefined;
            usd?: number | null | undefined;
        } | undefined;
        bidSize?: number | null | undefined;
        askSize?: number | null | undefined;
        estimatedFees?: {
            maker: number;
            taker: number;
        } | null | undefined;
        openInterest?: number | null | undefined;
        volume24h?: number | null | undefined;
        openInterestUsd?: number | null | undefined;
        volume24hUsd?: number | null | undefined;
        mark?: {
            raw?: number | null | undefined;
            rawCurrency?: string | undefined;
            usd?: number | null | undefined;
        } | undefined;
        last?: {
            raw?: number | null | undefined;
            rawCurrency?: string | undefined;
            usd?: number | null | undefined;
        } | null | undefined;
        underlyingPriceUsd?: number | null | undefined;
        timestamp?: number | null | undefined;
        source?: string | undefined;
    }, {
        indexPriceUsd?: number | null | undefined;
        bid?: {
            raw?: number | null | undefined;
            rawCurrency?: string | undefined;
            usd?: number | null | undefined;
        } | undefined;
        ask?: {
            raw?: number | null | undefined;
            rawCurrency?: string | undefined;
            usd?: number | null | undefined;
        } | undefined;
        bidSize?: number | null | undefined;
        askSize?: number | null | undefined;
        estimatedFees?: {
            maker: number;
            taker: number;
        } | null | undefined;
        openInterest?: number | null | undefined;
        volume24h?: number | null | undefined;
        openInterestUsd?: number | null | undefined;
        volume24hUsd?: number | null | undefined;
        mark?: {
            raw?: number | null | undefined;
            rawCurrency?: string | undefined;
            usd?: number | null | undefined;
        } | undefined;
        last?: {
            raw?: number | null | undefined;
            rawCurrency?: string | undefined;
            usd?: number | null | undefined;
        } | null | undefined;
        underlyingPriceUsd?: number | null | undefined;
        timestamp?: number | null | undefined;
        source?: string | undefined;
    }>>;
    greeks: z.ZodOptional<z.ZodObject<{
        delta: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
        gamma: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
        theta: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
        vega: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
        rho: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
        markIv: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
        bidIv: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
        askIv: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
    }, "strip", z.ZodTypeAny, {
        markIv?: number | null | undefined;
        bidIv?: number | null | undefined;
        askIv?: number | null | undefined;
        delta?: number | null | undefined;
        gamma?: number | null | undefined;
        theta?: number | null | undefined;
        vega?: number | null | undefined;
        rho?: number | null | undefined;
    }, {
        markIv?: number | null | undefined;
        bidIv?: number | null | undefined;
        askIv?: number | null | undefined;
        delta?: number | null | undefined;
        gamma?: number | null | undefined;
        theta?: number | null | undefined;
        vega?: number | null | undefined;
        rho?: number | null | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    symbol: string;
    venue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade";
    ts: number;
    quote?: {
        indexPriceUsd?: number | null | undefined;
        bid?: {
            raw?: number | null | undefined;
            rawCurrency?: string | undefined;
            usd?: number | null | undefined;
        } | undefined;
        ask?: {
            raw?: number | null | undefined;
            rawCurrency?: string | undefined;
            usd?: number | null | undefined;
        } | undefined;
        bidSize?: number | null | undefined;
        askSize?: number | null | undefined;
        estimatedFees?: {
            maker: number;
            taker: number;
        } | null | undefined;
        openInterest?: number | null | undefined;
        volume24h?: number | null | undefined;
        openInterestUsd?: number | null | undefined;
        volume24hUsd?: number | null | undefined;
        mark?: {
            raw?: number | null | undefined;
            rawCurrency?: string | undefined;
            usd?: number | null | undefined;
        } | undefined;
        last?: {
            raw?: number | null | undefined;
            rawCurrency?: string | undefined;
            usd?: number | null | undefined;
        } | null | undefined;
        underlyingPriceUsd?: number | null | undefined;
        timestamp?: number | null | undefined;
        source?: string | undefined;
    } | undefined;
    greeks?: {
        markIv?: number | null | undefined;
        bidIv?: number | null | undefined;
        askIv?: number | null | undefined;
        delta?: number | null | undefined;
        gamma?: number | null | undefined;
        theta?: number | null | undefined;
        vega?: number | null | undefined;
        rho?: number | null | undefined;
    } | undefined;
}, {
    symbol: string;
    venue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade";
    ts: number;
    quote?: {
        indexPriceUsd?: number | null | undefined;
        bid?: {
            raw?: number | null | undefined;
            rawCurrency?: string | undefined;
            usd?: number | null | undefined;
        } | undefined;
        ask?: {
            raw?: number | null | undefined;
            rawCurrency?: string | undefined;
            usd?: number | null | undefined;
        } | undefined;
        bidSize?: number | null | undefined;
        askSize?: number | null | undefined;
        estimatedFees?: {
            maker: number;
            taker: number;
        } | null | undefined;
        openInterest?: number | null | undefined;
        volume24h?: number | null | undefined;
        openInterestUsd?: number | null | undefined;
        volume24hUsd?: number | null | undefined;
        mark?: {
            raw?: number | null | undefined;
            rawCurrency?: string | undefined;
            usd?: number | null | undefined;
        } | undefined;
        last?: {
            raw?: number | null | undefined;
            rawCurrency?: string | undefined;
            usd?: number | null | undefined;
        } | null | undefined;
        underlyingPriceUsd?: number | null | undefined;
        timestamp?: number | null | undefined;
        source?: string | undefined;
    } | undefined;
    greeks?: {
        markIv?: number | null | undefined;
        bidIv?: number | null | undefined;
        askIv?: number | null | undefined;
        delta?: number | null | undefined;
        gamma?: number | null | undefined;
        theta?: number | null | undefined;
        vega?: number | null | undefined;
        rho?: number | null | undefined;
    } | undefined;
}>;
export declare const DeltaPatchSchema: z.ZodObject<{
    stats: z.ZodObject<{
        forwardPriceUsd: z.ZodNullable<z.ZodNumber>;
        indexPriceUsd: z.ZodNullable<z.ZodNumber>;
        basisPct: z.ZodNullable<z.ZodNumber>;
        atmStrike: z.ZodNullable<z.ZodNumber>;
        atmIv: z.ZodNullable<z.ZodNumber>;
        putCallOiRatio: z.ZodNullable<z.ZodNumber>;
        totalOiUsd: z.ZodNullable<z.ZodNumber>;
        skew25d: z.ZodNullable<z.ZodNumber>;
        bfly25d: z.ZodNullable<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        forwardPriceUsd: number | null;
        indexPriceUsd: number | null;
        basisPct: number | null;
        atmStrike: number | null;
        atmIv: number | null;
        putCallOiRatio: number | null;
        totalOiUsd: number | null;
        skew25d: number | null;
        bfly25d: number | null;
    }, {
        forwardPriceUsd: number | null;
        indexPriceUsd: number | null;
        basisPct: number | null;
        atmStrike: number | null;
        atmIv: number | null;
        putCallOiRatio: number | null;
        totalOiUsd: number | null;
        skew25d: number | null;
        bfly25d: number | null;
    }>;
    strikes: z.ZodArray<z.ZodObject<{
        strike: z.ZodNumber;
        call: z.ZodObject<{
            venues: z.ZodRecord<z.ZodString, z.ZodObject<{
                bid: z.ZodNullable<z.ZodNumber>;
                ask: z.ZodNullable<z.ZodNumber>;
                mid: z.ZodNullable<z.ZodNumber>;
                bidSize: z.ZodNullable<z.ZodNumber>;
                askSize: z.ZodNullable<z.ZodNumber>;
                markIv: z.ZodNullable<z.ZodNumber>;
                bidIv: z.ZodNullable<z.ZodNumber>;
                askIv: z.ZodNullable<z.ZodNumber>;
                delta: z.ZodNullable<z.ZodNumber>;
                gamma: z.ZodNullable<z.ZodNumber>;
                theta: z.ZodNullable<z.ZodNumber>;
                vega: z.ZodNullable<z.ZodNumber>;
                spreadPct: z.ZodNullable<z.ZodNumber>;
                totalCost: z.ZodNullable<z.ZodNumber>;
                estimatedFees: z.ZodNullable<z.ZodObject<{
                    maker: z.ZodNumber;
                    taker: z.ZodNumber;
                }, "strip", z.ZodTypeAny, {
                    maker: number;
                    taker: number;
                }, {
                    maker: number;
                    taker: number;
                }>>;
                openInterest: z.ZodNullable<z.ZodNumber>;
                volume24h: z.ZodNullable<z.ZodNumber>;
                openInterestUsd: z.ZodNullable<z.ZodNumber>;
                volume24hUsd: z.ZodNullable<z.ZodNumber>;
            }, "strip", z.ZodTypeAny, {
                bid: number | null;
                ask: number | null;
                mid: number | null;
                bidSize: number | null;
                askSize: number | null;
                markIv: number | null;
                bidIv: number | null;
                askIv: number | null;
                delta: number | null;
                gamma: number | null;
                theta: number | null;
                vega: number | null;
                spreadPct: number | null;
                totalCost: number | null;
                estimatedFees: {
                    maker: number;
                    taker: number;
                } | null;
                openInterest: number | null;
                volume24h: number | null;
                openInterestUsd: number | null;
                volume24hUsd: number | null;
            }, {
                bid: number | null;
                ask: number | null;
                mid: number | null;
                bidSize: number | null;
                askSize: number | null;
                markIv: number | null;
                bidIv: number | null;
                askIv: number | null;
                delta: number | null;
                gamma: number | null;
                theta: number | null;
                vega: number | null;
                spreadPct: number | null;
                totalCost: number | null;
                estimatedFees: {
                    maker: number;
                    taker: number;
                } | null;
                openInterest: number | null;
                volume24h: number | null;
                openInterestUsd: number | null;
                volume24hUsd: number | null;
            }>>;
            bestIv: z.ZodNullable<z.ZodNumber>;
            bestVenue: z.ZodNullable<z.ZodEnum<["deribit", "okx", "bybit", "binance", "derive", "coincall", "thalex", "tastytrade"]>>;
        }, "strip", z.ZodTypeAny, {
            venues: Record<string, {
                bid: number | null;
                ask: number | null;
                mid: number | null;
                bidSize: number | null;
                askSize: number | null;
                markIv: number | null;
                bidIv: number | null;
                askIv: number | null;
                delta: number | null;
                gamma: number | null;
                theta: number | null;
                vega: number | null;
                spreadPct: number | null;
                totalCost: number | null;
                estimatedFees: {
                    maker: number;
                    taker: number;
                } | null;
                openInterest: number | null;
                volume24h: number | null;
                openInterestUsd: number | null;
                volume24hUsd: number | null;
            }>;
            bestIv: number | null;
            bestVenue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade" | null;
        }, {
            venues: Record<string, {
                bid: number | null;
                ask: number | null;
                mid: number | null;
                bidSize: number | null;
                askSize: number | null;
                markIv: number | null;
                bidIv: number | null;
                askIv: number | null;
                delta: number | null;
                gamma: number | null;
                theta: number | null;
                vega: number | null;
                spreadPct: number | null;
                totalCost: number | null;
                estimatedFees: {
                    maker: number;
                    taker: number;
                } | null;
                openInterest: number | null;
                volume24h: number | null;
                openInterestUsd: number | null;
                volume24hUsd: number | null;
            }>;
            bestIv: number | null;
            bestVenue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade" | null;
        }>;
        put: z.ZodObject<{
            venues: z.ZodRecord<z.ZodString, z.ZodObject<{
                bid: z.ZodNullable<z.ZodNumber>;
                ask: z.ZodNullable<z.ZodNumber>;
                mid: z.ZodNullable<z.ZodNumber>;
                bidSize: z.ZodNullable<z.ZodNumber>;
                askSize: z.ZodNullable<z.ZodNumber>;
                markIv: z.ZodNullable<z.ZodNumber>;
                bidIv: z.ZodNullable<z.ZodNumber>;
                askIv: z.ZodNullable<z.ZodNumber>;
                delta: z.ZodNullable<z.ZodNumber>;
                gamma: z.ZodNullable<z.ZodNumber>;
                theta: z.ZodNullable<z.ZodNumber>;
                vega: z.ZodNullable<z.ZodNumber>;
                spreadPct: z.ZodNullable<z.ZodNumber>;
                totalCost: z.ZodNullable<z.ZodNumber>;
                estimatedFees: z.ZodNullable<z.ZodObject<{
                    maker: z.ZodNumber;
                    taker: z.ZodNumber;
                }, "strip", z.ZodTypeAny, {
                    maker: number;
                    taker: number;
                }, {
                    maker: number;
                    taker: number;
                }>>;
                openInterest: z.ZodNullable<z.ZodNumber>;
                volume24h: z.ZodNullable<z.ZodNumber>;
                openInterestUsd: z.ZodNullable<z.ZodNumber>;
                volume24hUsd: z.ZodNullable<z.ZodNumber>;
            }, "strip", z.ZodTypeAny, {
                bid: number | null;
                ask: number | null;
                mid: number | null;
                bidSize: number | null;
                askSize: number | null;
                markIv: number | null;
                bidIv: number | null;
                askIv: number | null;
                delta: number | null;
                gamma: number | null;
                theta: number | null;
                vega: number | null;
                spreadPct: number | null;
                totalCost: number | null;
                estimatedFees: {
                    maker: number;
                    taker: number;
                } | null;
                openInterest: number | null;
                volume24h: number | null;
                openInterestUsd: number | null;
                volume24hUsd: number | null;
            }, {
                bid: number | null;
                ask: number | null;
                mid: number | null;
                bidSize: number | null;
                askSize: number | null;
                markIv: number | null;
                bidIv: number | null;
                askIv: number | null;
                delta: number | null;
                gamma: number | null;
                theta: number | null;
                vega: number | null;
                spreadPct: number | null;
                totalCost: number | null;
                estimatedFees: {
                    maker: number;
                    taker: number;
                } | null;
                openInterest: number | null;
                volume24h: number | null;
                openInterestUsd: number | null;
                volume24hUsd: number | null;
            }>>;
            bestIv: z.ZodNullable<z.ZodNumber>;
            bestVenue: z.ZodNullable<z.ZodEnum<["deribit", "okx", "bybit", "binance", "derive", "coincall", "thalex", "tastytrade"]>>;
        }, "strip", z.ZodTypeAny, {
            venues: Record<string, {
                bid: number | null;
                ask: number | null;
                mid: number | null;
                bidSize: number | null;
                askSize: number | null;
                markIv: number | null;
                bidIv: number | null;
                askIv: number | null;
                delta: number | null;
                gamma: number | null;
                theta: number | null;
                vega: number | null;
                spreadPct: number | null;
                totalCost: number | null;
                estimatedFees: {
                    maker: number;
                    taker: number;
                } | null;
                openInterest: number | null;
                volume24h: number | null;
                openInterestUsd: number | null;
                volume24hUsd: number | null;
            }>;
            bestIv: number | null;
            bestVenue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade" | null;
        }, {
            venues: Record<string, {
                bid: number | null;
                ask: number | null;
                mid: number | null;
                bidSize: number | null;
                askSize: number | null;
                markIv: number | null;
                bidIv: number | null;
                askIv: number | null;
                delta: number | null;
                gamma: number | null;
                theta: number | null;
                vega: number | null;
                spreadPct: number | null;
                totalCost: number | null;
                estimatedFees: {
                    maker: number;
                    taker: number;
                } | null;
                openInterest: number | null;
                volume24h: number | null;
                openInterestUsd: number | null;
                volume24hUsd: number | null;
            }>;
            bestIv: number | null;
            bestVenue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade" | null;
        }>;
    }, "strip", z.ZodTypeAny, {
        call: {
            venues: Record<string, {
                bid: number | null;
                ask: number | null;
                mid: number | null;
                bidSize: number | null;
                askSize: number | null;
                markIv: number | null;
                bidIv: number | null;
                askIv: number | null;
                delta: number | null;
                gamma: number | null;
                theta: number | null;
                vega: number | null;
                spreadPct: number | null;
                totalCost: number | null;
                estimatedFees: {
                    maker: number;
                    taker: number;
                } | null;
                openInterest: number | null;
                volume24h: number | null;
                openInterestUsd: number | null;
                volume24hUsd: number | null;
            }>;
            bestIv: number | null;
            bestVenue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade" | null;
        };
        put: {
            venues: Record<string, {
                bid: number | null;
                ask: number | null;
                mid: number | null;
                bidSize: number | null;
                askSize: number | null;
                markIv: number | null;
                bidIv: number | null;
                askIv: number | null;
                delta: number | null;
                gamma: number | null;
                theta: number | null;
                vega: number | null;
                spreadPct: number | null;
                totalCost: number | null;
                estimatedFees: {
                    maker: number;
                    taker: number;
                } | null;
                openInterest: number | null;
                volume24h: number | null;
                openInterestUsd: number | null;
                volume24hUsd: number | null;
            }>;
            bestIv: number | null;
            bestVenue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade" | null;
        };
        strike: number;
    }, {
        call: {
            venues: Record<string, {
                bid: number | null;
                ask: number | null;
                mid: number | null;
                bidSize: number | null;
                askSize: number | null;
                markIv: number | null;
                bidIv: number | null;
                askIv: number | null;
                delta: number | null;
                gamma: number | null;
                theta: number | null;
                vega: number | null;
                spreadPct: number | null;
                totalCost: number | null;
                estimatedFees: {
                    maker: number;
                    taker: number;
                } | null;
                openInterest: number | null;
                volume24h: number | null;
                openInterestUsd: number | null;
                volume24hUsd: number | null;
            }>;
            bestIv: number | null;
            bestVenue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade" | null;
        };
        put: {
            venues: Record<string, {
                bid: number | null;
                ask: number | null;
                mid: number | null;
                bidSize: number | null;
                askSize: number | null;
                markIv: number | null;
                bidIv: number | null;
                askIv: number | null;
                delta: number | null;
                gamma: number | null;
                theta: number | null;
                vega: number | null;
                spreadPct: number | null;
                totalCost: number | null;
                estimatedFees: {
                    maker: number;
                    taker: number;
                } | null;
                openInterest: number | null;
                volume24h: number | null;
                openInterestUsd: number | null;
                volume24hUsd: number | null;
            }>;
            bestIv: number | null;
            bestVenue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade" | null;
        };
        strike: number;
    }>, "many">;
    gex: z.ZodArray<z.ZodObject<{
        strike: z.ZodNumber;
        gexUsdMillions: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        strike: number;
        gexUsdMillions: number;
    }, {
        strike: number;
        gexUsdMillions: number;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    stats: {
        forwardPriceUsd: number | null;
        indexPriceUsd: number | null;
        basisPct: number | null;
        atmStrike: number | null;
        atmIv: number | null;
        putCallOiRatio: number | null;
        totalOiUsd: number | null;
        skew25d: number | null;
        bfly25d: number | null;
    };
    strikes: {
        call: {
            venues: Record<string, {
                bid: number | null;
                ask: number | null;
                mid: number | null;
                bidSize: number | null;
                askSize: number | null;
                markIv: number | null;
                bidIv: number | null;
                askIv: number | null;
                delta: number | null;
                gamma: number | null;
                theta: number | null;
                vega: number | null;
                spreadPct: number | null;
                totalCost: number | null;
                estimatedFees: {
                    maker: number;
                    taker: number;
                } | null;
                openInterest: number | null;
                volume24h: number | null;
                openInterestUsd: number | null;
                volume24hUsd: number | null;
            }>;
            bestIv: number | null;
            bestVenue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade" | null;
        };
        put: {
            venues: Record<string, {
                bid: number | null;
                ask: number | null;
                mid: number | null;
                bidSize: number | null;
                askSize: number | null;
                markIv: number | null;
                bidIv: number | null;
                askIv: number | null;
                delta: number | null;
                gamma: number | null;
                theta: number | null;
                vega: number | null;
                spreadPct: number | null;
                totalCost: number | null;
                estimatedFees: {
                    maker: number;
                    taker: number;
                } | null;
                openInterest: number | null;
                volume24h: number | null;
                openInterestUsd: number | null;
                volume24hUsd: number | null;
            }>;
            bestIv: number | null;
            bestVenue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade" | null;
        };
        strike: number;
    }[];
    gex: {
        strike: number;
        gexUsdMillions: number;
    }[];
}, {
    stats: {
        forwardPriceUsd: number | null;
        indexPriceUsd: number | null;
        basisPct: number | null;
        atmStrike: number | null;
        atmIv: number | null;
        putCallOiRatio: number | null;
        totalOiUsd: number | null;
        skew25d: number | null;
        bfly25d: number | null;
    };
    strikes: {
        call: {
            venues: Record<string, {
                bid: number | null;
                ask: number | null;
                mid: number | null;
                bidSize: number | null;
                askSize: number | null;
                markIv: number | null;
                bidIv: number | null;
                askIv: number | null;
                delta: number | null;
                gamma: number | null;
                theta: number | null;
                vega: number | null;
                spreadPct: number | null;
                totalCost: number | null;
                estimatedFees: {
                    maker: number;
                    taker: number;
                } | null;
                openInterest: number | null;
                volume24h: number | null;
                openInterestUsd: number | null;
                volume24hUsd: number | null;
            }>;
            bestIv: number | null;
            bestVenue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade" | null;
        };
        put: {
            venues: Record<string, {
                bid: number | null;
                ask: number | null;
                mid: number | null;
                bidSize: number | null;
                askSize: number | null;
                markIv: number | null;
                bidIv: number | null;
                askIv: number | null;
                delta: number | null;
                gamma: number | null;
                theta: number | null;
                vega: number | null;
                spreadPct: number | null;
                totalCost: number | null;
                estimatedFees: {
                    maker: number;
                    taker: number;
                } | null;
                openInterest: number | null;
                volume24h: number | null;
                openInterestUsd: number | null;
                volume24hUsd: number | null;
            }>;
            bestIv: number | null;
            bestVenue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade" | null;
        };
        strike: number;
    }[];
    gex: {
        strike: number;
        gexUsdMillions: number;
    }[];
}>;
export declare const ServerWsMessageSchema: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
    type: z.ZodLiteral<"subscribed">;
    subscriptionId: z.ZodString;
    request: z.ZodObject<{
        underlying: z.ZodString;
        expiry: z.ZodString;
        venues: z.ZodArray<z.ZodEnum<["deribit", "okx", "bybit", "binance", "derive", "coincall", "thalex", "tastytrade"]>, "many">;
    }, "strip", z.ZodTypeAny, {
        underlying: string;
        expiry: string;
        venues: ("deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade")[];
    }, {
        underlying: string;
        expiry: string;
        venues: ("deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade")[];
    }>;
    serverTime: z.ZodNumber;
    failedVenues: z.ZodOptional<z.ZodArray<z.ZodObject<{
        venue: z.ZodEnum<["deribit", "okx", "bybit", "binance", "derive", "coincall", "thalex", "tastytrade"]>;
        reason: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        venue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade";
        reason: string;
    }, {
        venue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade";
        reason: string;
    }>, "many">>;
}, "strip", z.ZodTypeAny, {
    type: "subscribed";
    subscriptionId: string;
    request: {
        underlying: string;
        expiry: string;
        venues: ("deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade")[];
    };
    serverTime: number;
    failedVenues?: {
        venue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade";
        reason: string;
    }[] | undefined;
}, {
    type: "subscribed";
    subscriptionId: string;
    request: {
        underlying: string;
        expiry: string;
        venues: ("deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade")[];
    };
    serverTime: number;
    failedVenues?: {
        venue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade";
        reason: string;
    }[] | undefined;
}>, z.ZodObject<{
    type: z.ZodLiteral<"snapshot">;
    subscriptionId: z.ZodString;
    seq: z.ZodNumber;
    request: z.ZodObject<{
        underlying: z.ZodString;
        expiry: z.ZodString;
        venues: z.ZodArray<z.ZodEnum<["deribit", "okx", "bybit", "binance", "derive", "coincall", "thalex", "tastytrade"]>, "many">;
    }, "strip", z.ZodTypeAny, {
        underlying: string;
        expiry: string;
        venues: ("deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade")[];
    }, {
        underlying: string;
        expiry: string;
        venues: ("deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade")[];
    }>;
    meta: z.ZodObject<{
        generatedAt: z.ZodNumber;
        maxQuoteTs: z.ZodNumber;
        staleMs: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        generatedAt: number;
        maxQuoteTs: number;
        staleMs: number;
    }, {
        generatedAt: number;
        maxQuoteTs: number;
        staleMs: number;
    }>;
    data: z.ZodObject<{
        underlying: z.ZodString;
        expiry: z.ZodString;
        expiryTs: z.ZodNullable<z.ZodNumber>;
        dte: z.ZodNumber;
        stats: z.ZodObject<{
            forwardPriceUsd: z.ZodNullable<z.ZodNumber>;
            indexPriceUsd: z.ZodNullable<z.ZodNumber>;
            basisPct: z.ZodNullable<z.ZodNumber>;
            atmStrike: z.ZodNullable<z.ZodNumber>;
            atmIv: z.ZodNullable<z.ZodNumber>;
            putCallOiRatio: z.ZodNullable<z.ZodNumber>;
            totalOiUsd: z.ZodNullable<z.ZodNumber>;
            skew25d: z.ZodNullable<z.ZodNumber>;
            bfly25d: z.ZodNullable<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            forwardPriceUsd: number | null;
            indexPriceUsd: number | null;
            basisPct: number | null;
            atmStrike: number | null;
            atmIv: number | null;
            putCallOiRatio: number | null;
            totalOiUsd: number | null;
            skew25d: number | null;
            bfly25d: number | null;
        }, {
            forwardPriceUsd: number | null;
            indexPriceUsd: number | null;
            basisPct: number | null;
            atmStrike: number | null;
            atmIv: number | null;
            putCallOiRatio: number | null;
            totalOiUsd: number | null;
            skew25d: number | null;
            bfly25d: number | null;
        }>;
        strikes: z.ZodArray<z.ZodObject<{
            strike: z.ZodNumber;
            call: z.ZodObject<{
                venues: z.ZodRecord<z.ZodString, z.ZodObject<{
                    bid: z.ZodNullable<z.ZodNumber>;
                    ask: z.ZodNullable<z.ZodNumber>;
                    mid: z.ZodNullable<z.ZodNumber>;
                    bidSize: z.ZodNullable<z.ZodNumber>;
                    askSize: z.ZodNullable<z.ZodNumber>;
                    markIv: z.ZodNullable<z.ZodNumber>;
                    bidIv: z.ZodNullable<z.ZodNumber>;
                    askIv: z.ZodNullable<z.ZodNumber>;
                    delta: z.ZodNullable<z.ZodNumber>;
                    gamma: z.ZodNullable<z.ZodNumber>;
                    theta: z.ZodNullable<z.ZodNumber>;
                    vega: z.ZodNullable<z.ZodNumber>;
                    spreadPct: z.ZodNullable<z.ZodNumber>;
                    totalCost: z.ZodNullable<z.ZodNumber>;
                    estimatedFees: z.ZodNullable<z.ZodObject<{
                        maker: z.ZodNumber;
                        taker: z.ZodNumber;
                    }, "strip", z.ZodTypeAny, {
                        maker: number;
                        taker: number;
                    }, {
                        maker: number;
                        taker: number;
                    }>>;
                    openInterest: z.ZodNullable<z.ZodNumber>;
                    volume24h: z.ZodNullable<z.ZodNumber>;
                    openInterestUsd: z.ZodNullable<z.ZodNumber>;
                    volume24hUsd: z.ZodNullable<z.ZodNumber>;
                }, "strip", z.ZodTypeAny, {
                    bid: number | null;
                    ask: number | null;
                    mid: number | null;
                    bidSize: number | null;
                    askSize: number | null;
                    markIv: number | null;
                    bidIv: number | null;
                    askIv: number | null;
                    delta: number | null;
                    gamma: number | null;
                    theta: number | null;
                    vega: number | null;
                    spreadPct: number | null;
                    totalCost: number | null;
                    estimatedFees: {
                        maker: number;
                        taker: number;
                    } | null;
                    openInterest: number | null;
                    volume24h: number | null;
                    openInterestUsd: number | null;
                    volume24hUsd: number | null;
                }, {
                    bid: number | null;
                    ask: number | null;
                    mid: number | null;
                    bidSize: number | null;
                    askSize: number | null;
                    markIv: number | null;
                    bidIv: number | null;
                    askIv: number | null;
                    delta: number | null;
                    gamma: number | null;
                    theta: number | null;
                    vega: number | null;
                    spreadPct: number | null;
                    totalCost: number | null;
                    estimatedFees: {
                        maker: number;
                        taker: number;
                    } | null;
                    openInterest: number | null;
                    volume24h: number | null;
                    openInterestUsd: number | null;
                    volume24hUsd: number | null;
                }>>;
                bestIv: z.ZodNullable<z.ZodNumber>;
                bestVenue: z.ZodNullable<z.ZodEnum<["deribit", "okx", "bybit", "binance", "derive", "coincall", "thalex", "tastytrade"]>>;
            }, "strip", z.ZodTypeAny, {
                venues: Record<string, {
                    bid: number | null;
                    ask: number | null;
                    mid: number | null;
                    bidSize: number | null;
                    askSize: number | null;
                    markIv: number | null;
                    bidIv: number | null;
                    askIv: number | null;
                    delta: number | null;
                    gamma: number | null;
                    theta: number | null;
                    vega: number | null;
                    spreadPct: number | null;
                    totalCost: number | null;
                    estimatedFees: {
                        maker: number;
                        taker: number;
                    } | null;
                    openInterest: number | null;
                    volume24h: number | null;
                    openInterestUsd: number | null;
                    volume24hUsd: number | null;
                }>;
                bestIv: number | null;
                bestVenue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade" | null;
            }, {
                venues: Record<string, {
                    bid: number | null;
                    ask: number | null;
                    mid: number | null;
                    bidSize: number | null;
                    askSize: number | null;
                    markIv: number | null;
                    bidIv: number | null;
                    askIv: number | null;
                    delta: number | null;
                    gamma: number | null;
                    theta: number | null;
                    vega: number | null;
                    spreadPct: number | null;
                    totalCost: number | null;
                    estimatedFees: {
                        maker: number;
                        taker: number;
                    } | null;
                    openInterest: number | null;
                    volume24h: number | null;
                    openInterestUsd: number | null;
                    volume24hUsd: number | null;
                }>;
                bestIv: number | null;
                bestVenue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade" | null;
            }>;
            put: z.ZodObject<{
                venues: z.ZodRecord<z.ZodString, z.ZodObject<{
                    bid: z.ZodNullable<z.ZodNumber>;
                    ask: z.ZodNullable<z.ZodNumber>;
                    mid: z.ZodNullable<z.ZodNumber>;
                    bidSize: z.ZodNullable<z.ZodNumber>;
                    askSize: z.ZodNullable<z.ZodNumber>;
                    markIv: z.ZodNullable<z.ZodNumber>;
                    bidIv: z.ZodNullable<z.ZodNumber>;
                    askIv: z.ZodNullable<z.ZodNumber>;
                    delta: z.ZodNullable<z.ZodNumber>;
                    gamma: z.ZodNullable<z.ZodNumber>;
                    theta: z.ZodNullable<z.ZodNumber>;
                    vega: z.ZodNullable<z.ZodNumber>;
                    spreadPct: z.ZodNullable<z.ZodNumber>;
                    totalCost: z.ZodNullable<z.ZodNumber>;
                    estimatedFees: z.ZodNullable<z.ZodObject<{
                        maker: z.ZodNumber;
                        taker: z.ZodNumber;
                    }, "strip", z.ZodTypeAny, {
                        maker: number;
                        taker: number;
                    }, {
                        maker: number;
                        taker: number;
                    }>>;
                    openInterest: z.ZodNullable<z.ZodNumber>;
                    volume24h: z.ZodNullable<z.ZodNumber>;
                    openInterestUsd: z.ZodNullable<z.ZodNumber>;
                    volume24hUsd: z.ZodNullable<z.ZodNumber>;
                }, "strip", z.ZodTypeAny, {
                    bid: number | null;
                    ask: number | null;
                    mid: number | null;
                    bidSize: number | null;
                    askSize: number | null;
                    markIv: number | null;
                    bidIv: number | null;
                    askIv: number | null;
                    delta: number | null;
                    gamma: number | null;
                    theta: number | null;
                    vega: number | null;
                    spreadPct: number | null;
                    totalCost: number | null;
                    estimatedFees: {
                        maker: number;
                        taker: number;
                    } | null;
                    openInterest: number | null;
                    volume24h: number | null;
                    openInterestUsd: number | null;
                    volume24hUsd: number | null;
                }, {
                    bid: number | null;
                    ask: number | null;
                    mid: number | null;
                    bidSize: number | null;
                    askSize: number | null;
                    markIv: number | null;
                    bidIv: number | null;
                    askIv: number | null;
                    delta: number | null;
                    gamma: number | null;
                    theta: number | null;
                    vega: number | null;
                    spreadPct: number | null;
                    totalCost: number | null;
                    estimatedFees: {
                        maker: number;
                        taker: number;
                    } | null;
                    openInterest: number | null;
                    volume24h: number | null;
                    openInterestUsd: number | null;
                    volume24hUsd: number | null;
                }>>;
                bestIv: z.ZodNullable<z.ZodNumber>;
                bestVenue: z.ZodNullable<z.ZodEnum<["deribit", "okx", "bybit", "binance", "derive", "coincall", "thalex", "tastytrade"]>>;
            }, "strip", z.ZodTypeAny, {
                venues: Record<string, {
                    bid: number | null;
                    ask: number | null;
                    mid: number | null;
                    bidSize: number | null;
                    askSize: number | null;
                    markIv: number | null;
                    bidIv: number | null;
                    askIv: number | null;
                    delta: number | null;
                    gamma: number | null;
                    theta: number | null;
                    vega: number | null;
                    spreadPct: number | null;
                    totalCost: number | null;
                    estimatedFees: {
                        maker: number;
                        taker: number;
                    } | null;
                    openInterest: number | null;
                    volume24h: number | null;
                    openInterestUsd: number | null;
                    volume24hUsd: number | null;
                }>;
                bestIv: number | null;
                bestVenue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade" | null;
            }, {
                venues: Record<string, {
                    bid: number | null;
                    ask: number | null;
                    mid: number | null;
                    bidSize: number | null;
                    askSize: number | null;
                    markIv: number | null;
                    bidIv: number | null;
                    askIv: number | null;
                    delta: number | null;
                    gamma: number | null;
                    theta: number | null;
                    vega: number | null;
                    spreadPct: number | null;
                    totalCost: number | null;
                    estimatedFees: {
                        maker: number;
                        taker: number;
                    } | null;
                    openInterest: number | null;
                    volume24h: number | null;
                    openInterestUsd: number | null;
                    volume24hUsd: number | null;
                }>;
                bestIv: number | null;
                bestVenue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade" | null;
            }>;
        }, "strip", z.ZodTypeAny, {
            call: {
                venues: Record<string, {
                    bid: number | null;
                    ask: number | null;
                    mid: number | null;
                    bidSize: number | null;
                    askSize: number | null;
                    markIv: number | null;
                    bidIv: number | null;
                    askIv: number | null;
                    delta: number | null;
                    gamma: number | null;
                    theta: number | null;
                    vega: number | null;
                    spreadPct: number | null;
                    totalCost: number | null;
                    estimatedFees: {
                        maker: number;
                        taker: number;
                    } | null;
                    openInterest: number | null;
                    volume24h: number | null;
                    openInterestUsd: number | null;
                    volume24hUsd: number | null;
                }>;
                bestIv: number | null;
                bestVenue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade" | null;
            };
            put: {
                venues: Record<string, {
                    bid: number | null;
                    ask: number | null;
                    mid: number | null;
                    bidSize: number | null;
                    askSize: number | null;
                    markIv: number | null;
                    bidIv: number | null;
                    askIv: number | null;
                    delta: number | null;
                    gamma: number | null;
                    theta: number | null;
                    vega: number | null;
                    spreadPct: number | null;
                    totalCost: number | null;
                    estimatedFees: {
                        maker: number;
                        taker: number;
                    } | null;
                    openInterest: number | null;
                    volume24h: number | null;
                    openInterestUsd: number | null;
                    volume24hUsd: number | null;
                }>;
                bestIv: number | null;
                bestVenue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade" | null;
            };
            strike: number;
        }, {
            call: {
                venues: Record<string, {
                    bid: number | null;
                    ask: number | null;
                    mid: number | null;
                    bidSize: number | null;
                    askSize: number | null;
                    markIv: number | null;
                    bidIv: number | null;
                    askIv: number | null;
                    delta: number | null;
                    gamma: number | null;
                    theta: number | null;
                    vega: number | null;
                    spreadPct: number | null;
                    totalCost: number | null;
                    estimatedFees: {
                        maker: number;
                        taker: number;
                    } | null;
                    openInterest: number | null;
                    volume24h: number | null;
                    openInterestUsd: number | null;
                    volume24hUsd: number | null;
                }>;
                bestIv: number | null;
                bestVenue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade" | null;
            };
            put: {
                venues: Record<string, {
                    bid: number | null;
                    ask: number | null;
                    mid: number | null;
                    bidSize: number | null;
                    askSize: number | null;
                    markIv: number | null;
                    bidIv: number | null;
                    askIv: number | null;
                    delta: number | null;
                    gamma: number | null;
                    theta: number | null;
                    vega: number | null;
                    spreadPct: number | null;
                    totalCost: number | null;
                    estimatedFees: {
                        maker: number;
                        taker: number;
                    } | null;
                    openInterest: number | null;
                    volume24h: number | null;
                    openInterestUsd: number | null;
                    volume24hUsd: number | null;
                }>;
                bestIv: number | null;
                bestVenue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade" | null;
            };
            strike: number;
        }>, "many">;
        gex: z.ZodArray<z.ZodObject<{
            strike: z.ZodNumber;
            gexUsdMillions: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            strike: number;
            gexUsdMillions: number;
        }, {
            strike: number;
            gexUsdMillions: number;
        }>, "many">;
    }, "strip", z.ZodTypeAny, {
        underlying: string;
        expiry: string;
        expiryTs: number | null;
        dte: number;
        stats: {
            forwardPriceUsd: number | null;
            indexPriceUsd: number | null;
            basisPct: number | null;
            atmStrike: number | null;
            atmIv: number | null;
            putCallOiRatio: number | null;
            totalOiUsd: number | null;
            skew25d: number | null;
            bfly25d: number | null;
        };
        strikes: {
            call: {
                venues: Record<string, {
                    bid: number | null;
                    ask: number | null;
                    mid: number | null;
                    bidSize: number | null;
                    askSize: number | null;
                    markIv: number | null;
                    bidIv: number | null;
                    askIv: number | null;
                    delta: number | null;
                    gamma: number | null;
                    theta: number | null;
                    vega: number | null;
                    spreadPct: number | null;
                    totalCost: number | null;
                    estimatedFees: {
                        maker: number;
                        taker: number;
                    } | null;
                    openInterest: number | null;
                    volume24h: number | null;
                    openInterestUsd: number | null;
                    volume24hUsd: number | null;
                }>;
                bestIv: number | null;
                bestVenue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade" | null;
            };
            put: {
                venues: Record<string, {
                    bid: number | null;
                    ask: number | null;
                    mid: number | null;
                    bidSize: number | null;
                    askSize: number | null;
                    markIv: number | null;
                    bidIv: number | null;
                    askIv: number | null;
                    delta: number | null;
                    gamma: number | null;
                    theta: number | null;
                    vega: number | null;
                    spreadPct: number | null;
                    totalCost: number | null;
                    estimatedFees: {
                        maker: number;
                        taker: number;
                    } | null;
                    openInterest: number | null;
                    volume24h: number | null;
                    openInterestUsd: number | null;
                    volume24hUsd: number | null;
                }>;
                bestIv: number | null;
                bestVenue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade" | null;
            };
            strike: number;
        }[];
        gex: {
            strike: number;
            gexUsdMillions: number;
        }[];
    }, {
        underlying: string;
        expiry: string;
        expiryTs: number | null;
        dte: number;
        stats: {
            forwardPriceUsd: number | null;
            indexPriceUsd: number | null;
            basisPct: number | null;
            atmStrike: number | null;
            atmIv: number | null;
            putCallOiRatio: number | null;
            totalOiUsd: number | null;
            skew25d: number | null;
            bfly25d: number | null;
        };
        strikes: {
            call: {
                venues: Record<string, {
                    bid: number | null;
                    ask: number | null;
                    mid: number | null;
                    bidSize: number | null;
                    askSize: number | null;
                    markIv: number | null;
                    bidIv: number | null;
                    askIv: number | null;
                    delta: number | null;
                    gamma: number | null;
                    theta: number | null;
                    vega: number | null;
                    spreadPct: number | null;
                    totalCost: number | null;
                    estimatedFees: {
                        maker: number;
                        taker: number;
                    } | null;
                    openInterest: number | null;
                    volume24h: number | null;
                    openInterestUsd: number | null;
                    volume24hUsd: number | null;
                }>;
                bestIv: number | null;
                bestVenue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade" | null;
            };
            put: {
                venues: Record<string, {
                    bid: number | null;
                    ask: number | null;
                    mid: number | null;
                    bidSize: number | null;
                    askSize: number | null;
                    markIv: number | null;
                    bidIv: number | null;
                    askIv: number | null;
                    delta: number | null;
                    gamma: number | null;
                    theta: number | null;
                    vega: number | null;
                    spreadPct: number | null;
                    totalCost: number | null;
                    estimatedFees: {
                        maker: number;
                        taker: number;
                    } | null;
                    openInterest: number | null;
                    volume24h: number | null;
                    openInterestUsd: number | null;
                    volume24hUsd: number | null;
                }>;
                bestIv: number | null;
                bestVenue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade" | null;
            };
            strike: number;
        }[];
        gex: {
            strike: number;
            gexUsdMillions: number;
        }[];
    }>;
}, "strip", z.ZodTypeAny, {
    type: "snapshot";
    subscriptionId: string;
    request: {
        underlying: string;
        expiry: string;
        venues: ("deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade")[];
    };
    seq: number;
    meta: {
        generatedAt: number;
        maxQuoteTs: number;
        staleMs: number;
    };
    data: {
        underlying: string;
        expiry: string;
        expiryTs: number | null;
        dte: number;
        stats: {
            forwardPriceUsd: number | null;
            indexPriceUsd: number | null;
            basisPct: number | null;
            atmStrike: number | null;
            atmIv: number | null;
            putCallOiRatio: number | null;
            totalOiUsd: number | null;
            skew25d: number | null;
            bfly25d: number | null;
        };
        strikes: {
            call: {
                venues: Record<string, {
                    bid: number | null;
                    ask: number | null;
                    mid: number | null;
                    bidSize: number | null;
                    askSize: number | null;
                    markIv: number | null;
                    bidIv: number | null;
                    askIv: number | null;
                    delta: number | null;
                    gamma: number | null;
                    theta: number | null;
                    vega: number | null;
                    spreadPct: number | null;
                    totalCost: number | null;
                    estimatedFees: {
                        maker: number;
                        taker: number;
                    } | null;
                    openInterest: number | null;
                    volume24h: number | null;
                    openInterestUsd: number | null;
                    volume24hUsd: number | null;
                }>;
                bestIv: number | null;
                bestVenue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade" | null;
            };
            put: {
                venues: Record<string, {
                    bid: number | null;
                    ask: number | null;
                    mid: number | null;
                    bidSize: number | null;
                    askSize: number | null;
                    markIv: number | null;
                    bidIv: number | null;
                    askIv: number | null;
                    delta: number | null;
                    gamma: number | null;
                    theta: number | null;
                    vega: number | null;
                    spreadPct: number | null;
                    totalCost: number | null;
                    estimatedFees: {
                        maker: number;
                        taker: number;
                    } | null;
                    openInterest: number | null;
                    volume24h: number | null;
                    openInterestUsd: number | null;
                    volume24hUsd: number | null;
                }>;
                bestIv: number | null;
                bestVenue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade" | null;
            };
            strike: number;
        }[];
        gex: {
            strike: number;
            gexUsdMillions: number;
        }[];
    };
}, {
    type: "snapshot";
    subscriptionId: string;
    request: {
        underlying: string;
        expiry: string;
        venues: ("deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade")[];
    };
    seq: number;
    meta: {
        generatedAt: number;
        maxQuoteTs: number;
        staleMs: number;
    };
    data: {
        underlying: string;
        expiry: string;
        expiryTs: number | null;
        dte: number;
        stats: {
            forwardPriceUsd: number | null;
            indexPriceUsd: number | null;
            basisPct: number | null;
            atmStrike: number | null;
            atmIv: number | null;
            putCallOiRatio: number | null;
            totalOiUsd: number | null;
            skew25d: number | null;
            bfly25d: number | null;
        };
        strikes: {
            call: {
                venues: Record<string, {
                    bid: number | null;
                    ask: number | null;
                    mid: number | null;
                    bidSize: number | null;
                    askSize: number | null;
                    markIv: number | null;
                    bidIv: number | null;
                    askIv: number | null;
                    delta: number | null;
                    gamma: number | null;
                    theta: number | null;
                    vega: number | null;
                    spreadPct: number | null;
                    totalCost: number | null;
                    estimatedFees: {
                        maker: number;
                        taker: number;
                    } | null;
                    openInterest: number | null;
                    volume24h: number | null;
                    openInterestUsd: number | null;
                    volume24hUsd: number | null;
                }>;
                bestIv: number | null;
                bestVenue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade" | null;
            };
            put: {
                venues: Record<string, {
                    bid: number | null;
                    ask: number | null;
                    mid: number | null;
                    bidSize: number | null;
                    askSize: number | null;
                    markIv: number | null;
                    bidIv: number | null;
                    askIv: number | null;
                    delta: number | null;
                    gamma: number | null;
                    theta: number | null;
                    vega: number | null;
                    spreadPct: number | null;
                    totalCost: number | null;
                    estimatedFees: {
                        maker: number;
                        taker: number;
                    } | null;
                    openInterest: number | null;
                    volume24h: number | null;
                    openInterestUsd: number | null;
                    volume24hUsd: number | null;
                }>;
                bestIv: number | null;
                bestVenue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade" | null;
            };
            strike: number;
        }[];
        gex: {
            strike: number;
            gexUsdMillions: number;
        }[];
    };
}>, z.ZodObject<{
    type: z.ZodLiteral<"delta">;
    subscriptionId: z.ZodString;
    seq: z.ZodNumber;
    request: z.ZodObject<{
        underlying: z.ZodString;
        expiry: z.ZodString;
        venues: z.ZodArray<z.ZodEnum<["deribit", "okx", "bybit", "binance", "derive", "coincall", "thalex", "tastytrade"]>, "many">;
    }, "strip", z.ZodTypeAny, {
        underlying: string;
        expiry: string;
        venues: ("deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade")[];
    }, {
        underlying: string;
        expiry: string;
        venues: ("deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade")[];
    }>;
    meta: z.ZodObject<{
        generatedAt: z.ZodNumber;
        maxQuoteTs: z.ZodNumber;
        staleMs: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        generatedAt: number;
        maxQuoteTs: number;
        staleMs: number;
    }, {
        generatedAt: number;
        maxQuoteTs: number;
        staleMs: number;
    }>;
    deltas: z.ZodArray<z.ZodObject<{
        venue: z.ZodEnum<["deribit", "okx", "bybit", "binance", "derive", "coincall", "thalex", "tastytrade"]>;
        symbol: z.ZodString;
        ts: z.ZodNumber;
        quote: z.ZodOptional<z.ZodObject<{
            bid: z.ZodOptional<z.ZodOptional<z.ZodObject<{
                raw: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                rawCurrency: z.ZodOptional<z.ZodString>;
                usd: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            }, "strip", z.ZodTypeAny, {
                raw?: number | null | undefined;
                rawCurrency?: string | undefined;
                usd?: number | null | undefined;
            }, {
                raw?: number | null | undefined;
                rawCurrency?: string | undefined;
                usd?: number | null | undefined;
            }>>>;
            ask: z.ZodOptional<z.ZodOptional<z.ZodObject<{
                raw: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                rawCurrency: z.ZodOptional<z.ZodString>;
                usd: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            }, "strip", z.ZodTypeAny, {
                raw?: number | null | undefined;
                rawCurrency?: string | undefined;
                usd?: number | null | undefined;
            }, {
                raw?: number | null | undefined;
                rawCurrency?: string | undefined;
                usd?: number | null | undefined;
            }>>>;
            mark: z.ZodOptional<z.ZodOptional<z.ZodObject<{
                raw: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                rawCurrency: z.ZodOptional<z.ZodString>;
                usd: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            }, "strip", z.ZodTypeAny, {
                raw?: number | null | undefined;
                rawCurrency?: string | undefined;
                usd?: number | null | undefined;
            }, {
                raw?: number | null | undefined;
                rawCurrency?: string | undefined;
                usd?: number | null | undefined;
            }>>>;
            last: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodObject<{
                raw: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                rawCurrency: z.ZodOptional<z.ZodString>;
                usd: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            }, "strip", z.ZodTypeAny, {
                raw?: number | null | undefined;
                rawCurrency?: string | undefined;
                usd?: number | null | undefined;
            }, {
                raw?: number | null | undefined;
                rawCurrency?: string | undefined;
                usd?: number | null | undefined;
            }>>>>;
            bidSize: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
            askSize: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
            underlyingPriceUsd: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
            indexPriceUsd: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
            volume24h: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
            openInterest: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
            openInterestUsd: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
            volume24hUsd: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
            estimatedFees: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodObject<{
                maker: z.ZodNumber;
                taker: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                maker: number;
                taker: number;
            }, {
                maker: number;
                taker: number;
            }>>>>;
            timestamp: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
            source: z.ZodOptional<z.ZodOptional<z.ZodString>>;
        }, "strip", z.ZodTypeAny, {
            indexPriceUsd?: number | null | undefined;
            bid?: {
                raw?: number | null | undefined;
                rawCurrency?: string | undefined;
                usd?: number | null | undefined;
            } | undefined;
            ask?: {
                raw?: number | null | undefined;
                rawCurrency?: string | undefined;
                usd?: number | null | undefined;
            } | undefined;
            bidSize?: number | null | undefined;
            askSize?: number | null | undefined;
            estimatedFees?: {
                maker: number;
                taker: number;
            } | null | undefined;
            openInterest?: number | null | undefined;
            volume24h?: number | null | undefined;
            openInterestUsd?: number | null | undefined;
            volume24hUsd?: number | null | undefined;
            mark?: {
                raw?: number | null | undefined;
                rawCurrency?: string | undefined;
                usd?: number | null | undefined;
            } | undefined;
            last?: {
                raw?: number | null | undefined;
                rawCurrency?: string | undefined;
                usd?: number | null | undefined;
            } | null | undefined;
            underlyingPriceUsd?: number | null | undefined;
            timestamp?: number | null | undefined;
            source?: string | undefined;
        }, {
            indexPriceUsd?: number | null | undefined;
            bid?: {
                raw?: number | null | undefined;
                rawCurrency?: string | undefined;
                usd?: number | null | undefined;
            } | undefined;
            ask?: {
                raw?: number | null | undefined;
                rawCurrency?: string | undefined;
                usd?: number | null | undefined;
            } | undefined;
            bidSize?: number | null | undefined;
            askSize?: number | null | undefined;
            estimatedFees?: {
                maker: number;
                taker: number;
            } | null | undefined;
            openInterest?: number | null | undefined;
            volume24h?: number | null | undefined;
            openInterestUsd?: number | null | undefined;
            volume24hUsd?: number | null | undefined;
            mark?: {
                raw?: number | null | undefined;
                rawCurrency?: string | undefined;
                usd?: number | null | undefined;
            } | undefined;
            last?: {
                raw?: number | null | undefined;
                rawCurrency?: string | undefined;
                usd?: number | null | undefined;
            } | null | undefined;
            underlyingPriceUsd?: number | null | undefined;
            timestamp?: number | null | undefined;
            source?: string | undefined;
        }>>;
        greeks: z.ZodOptional<z.ZodObject<{
            delta: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
            gamma: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
            theta: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
            vega: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
            rho: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
            markIv: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
            bidIv: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
            askIv: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
        }, "strip", z.ZodTypeAny, {
            markIv?: number | null | undefined;
            bidIv?: number | null | undefined;
            askIv?: number | null | undefined;
            delta?: number | null | undefined;
            gamma?: number | null | undefined;
            theta?: number | null | undefined;
            vega?: number | null | undefined;
            rho?: number | null | undefined;
        }, {
            markIv?: number | null | undefined;
            bidIv?: number | null | undefined;
            askIv?: number | null | undefined;
            delta?: number | null | undefined;
            gamma?: number | null | undefined;
            theta?: number | null | undefined;
            vega?: number | null | undefined;
            rho?: number | null | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        symbol: string;
        venue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade";
        ts: number;
        quote?: {
            indexPriceUsd?: number | null | undefined;
            bid?: {
                raw?: number | null | undefined;
                rawCurrency?: string | undefined;
                usd?: number | null | undefined;
            } | undefined;
            ask?: {
                raw?: number | null | undefined;
                rawCurrency?: string | undefined;
                usd?: number | null | undefined;
            } | undefined;
            bidSize?: number | null | undefined;
            askSize?: number | null | undefined;
            estimatedFees?: {
                maker: number;
                taker: number;
            } | null | undefined;
            openInterest?: number | null | undefined;
            volume24h?: number | null | undefined;
            openInterestUsd?: number | null | undefined;
            volume24hUsd?: number | null | undefined;
            mark?: {
                raw?: number | null | undefined;
                rawCurrency?: string | undefined;
                usd?: number | null | undefined;
            } | undefined;
            last?: {
                raw?: number | null | undefined;
                rawCurrency?: string | undefined;
                usd?: number | null | undefined;
            } | null | undefined;
            underlyingPriceUsd?: number | null | undefined;
            timestamp?: number | null | undefined;
            source?: string | undefined;
        } | undefined;
        greeks?: {
            markIv?: number | null | undefined;
            bidIv?: number | null | undefined;
            askIv?: number | null | undefined;
            delta?: number | null | undefined;
            gamma?: number | null | undefined;
            theta?: number | null | undefined;
            vega?: number | null | undefined;
            rho?: number | null | undefined;
        } | undefined;
    }, {
        symbol: string;
        venue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade";
        ts: number;
        quote?: {
            indexPriceUsd?: number | null | undefined;
            bid?: {
                raw?: number | null | undefined;
                rawCurrency?: string | undefined;
                usd?: number | null | undefined;
            } | undefined;
            ask?: {
                raw?: number | null | undefined;
                rawCurrency?: string | undefined;
                usd?: number | null | undefined;
            } | undefined;
            bidSize?: number | null | undefined;
            askSize?: number | null | undefined;
            estimatedFees?: {
                maker: number;
                taker: number;
            } | null | undefined;
            openInterest?: number | null | undefined;
            volume24h?: number | null | undefined;
            openInterestUsd?: number | null | undefined;
            volume24hUsd?: number | null | undefined;
            mark?: {
                raw?: number | null | undefined;
                rawCurrency?: string | undefined;
                usd?: number | null | undefined;
            } | undefined;
            last?: {
                raw?: number | null | undefined;
                rawCurrency?: string | undefined;
                usd?: number | null | undefined;
            } | null | undefined;
            underlyingPriceUsd?: number | null | undefined;
            timestamp?: number | null | undefined;
            source?: string | undefined;
        } | undefined;
        greeks?: {
            markIv?: number | null | undefined;
            bidIv?: number | null | undefined;
            askIv?: number | null | undefined;
            delta?: number | null | undefined;
            gamma?: number | null | undefined;
            theta?: number | null | undefined;
            vega?: number | null | undefined;
            rho?: number | null | undefined;
        } | undefined;
    }>, "many">;
    patch: z.ZodObject<{
        stats: z.ZodObject<{
            forwardPriceUsd: z.ZodNullable<z.ZodNumber>;
            indexPriceUsd: z.ZodNullable<z.ZodNumber>;
            basisPct: z.ZodNullable<z.ZodNumber>;
            atmStrike: z.ZodNullable<z.ZodNumber>;
            atmIv: z.ZodNullable<z.ZodNumber>;
            putCallOiRatio: z.ZodNullable<z.ZodNumber>;
            totalOiUsd: z.ZodNullable<z.ZodNumber>;
            skew25d: z.ZodNullable<z.ZodNumber>;
            bfly25d: z.ZodNullable<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            forwardPriceUsd: number | null;
            indexPriceUsd: number | null;
            basisPct: number | null;
            atmStrike: number | null;
            atmIv: number | null;
            putCallOiRatio: number | null;
            totalOiUsd: number | null;
            skew25d: number | null;
            bfly25d: number | null;
        }, {
            forwardPriceUsd: number | null;
            indexPriceUsd: number | null;
            basisPct: number | null;
            atmStrike: number | null;
            atmIv: number | null;
            putCallOiRatio: number | null;
            totalOiUsd: number | null;
            skew25d: number | null;
            bfly25d: number | null;
        }>;
        strikes: z.ZodArray<z.ZodObject<{
            strike: z.ZodNumber;
            call: z.ZodObject<{
                venues: z.ZodRecord<z.ZodString, z.ZodObject<{
                    bid: z.ZodNullable<z.ZodNumber>;
                    ask: z.ZodNullable<z.ZodNumber>;
                    mid: z.ZodNullable<z.ZodNumber>;
                    bidSize: z.ZodNullable<z.ZodNumber>;
                    askSize: z.ZodNullable<z.ZodNumber>;
                    markIv: z.ZodNullable<z.ZodNumber>;
                    bidIv: z.ZodNullable<z.ZodNumber>;
                    askIv: z.ZodNullable<z.ZodNumber>;
                    delta: z.ZodNullable<z.ZodNumber>;
                    gamma: z.ZodNullable<z.ZodNumber>;
                    theta: z.ZodNullable<z.ZodNumber>;
                    vega: z.ZodNullable<z.ZodNumber>;
                    spreadPct: z.ZodNullable<z.ZodNumber>;
                    totalCost: z.ZodNullable<z.ZodNumber>;
                    estimatedFees: z.ZodNullable<z.ZodObject<{
                        maker: z.ZodNumber;
                        taker: z.ZodNumber;
                    }, "strip", z.ZodTypeAny, {
                        maker: number;
                        taker: number;
                    }, {
                        maker: number;
                        taker: number;
                    }>>;
                    openInterest: z.ZodNullable<z.ZodNumber>;
                    volume24h: z.ZodNullable<z.ZodNumber>;
                    openInterestUsd: z.ZodNullable<z.ZodNumber>;
                    volume24hUsd: z.ZodNullable<z.ZodNumber>;
                }, "strip", z.ZodTypeAny, {
                    bid: number | null;
                    ask: number | null;
                    mid: number | null;
                    bidSize: number | null;
                    askSize: number | null;
                    markIv: number | null;
                    bidIv: number | null;
                    askIv: number | null;
                    delta: number | null;
                    gamma: number | null;
                    theta: number | null;
                    vega: number | null;
                    spreadPct: number | null;
                    totalCost: number | null;
                    estimatedFees: {
                        maker: number;
                        taker: number;
                    } | null;
                    openInterest: number | null;
                    volume24h: number | null;
                    openInterestUsd: number | null;
                    volume24hUsd: number | null;
                }, {
                    bid: number | null;
                    ask: number | null;
                    mid: number | null;
                    bidSize: number | null;
                    askSize: number | null;
                    markIv: number | null;
                    bidIv: number | null;
                    askIv: number | null;
                    delta: number | null;
                    gamma: number | null;
                    theta: number | null;
                    vega: number | null;
                    spreadPct: number | null;
                    totalCost: number | null;
                    estimatedFees: {
                        maker: number;
                        taker: number;
                    } | null;
                    openInterest: number | null;
                    volume24h: number | null;
                    openInterestUsd: number | null;
                    volume24hUsd: number | null;
                }>>;
                bestIv: z.ZodNullable<z.ZodNumber>;
                bestVenue: z.ZodNullable<z.ZodEnum<["deribit", "okx", "bybit", "binance", "derive", "coincall", "thalex", "tastytrade"]>>;
            }, "strip", z.ZodTypeAny, {
                venues: Record<string, {
                    bid: number | null;
                    ask: number | null;
                    mid: number | null;
                    bidSize: number | null;
                    askSize: number | null;
                    markIv: number | null;
                    bidIv: number | null;
                    askIv: number | null;
                    delta: number | null;
                    gamma: number | null;
                    theta: number | null;
                    vega: number | null;
                    spreadPct: number | null;
                    totalCost: number | null;
                    estimatedFees: {
                        maker: number;
                        taker: number;
                    } | null;
                    openInterest: number | null;
                    volume24h: number | null;
                    openInterestUsd: number | null;
                    volume24hUsd: number | null;
                }>;
                bestIv: number | null;
                bestVenue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade" | null;
            }, {
                venues: Record<string, {
                    bid: number | null;
                    ask: number | null;
                    mid: number | null;
                    bidSize: number | null;
                    askSize: number | null;
                    markIv: number | null;
                    bidIv: number | null;
                    askIv: number | null;
                    delta: number | null;
                    gamma: number | null;
                    theta: number | null;
                    vega: number | null;
                    spreadPct: number | null;
                    totalCost: number | null;
                    estimatedFees: {
                        maker: number;
                        taker: number;
                    } | null;
                    openInterest: number | null;
                    volume24h: number | null;
                    openInterestUsd: number | null;
                    volume24hUsd: number | null;
                }>;
                bestIv: number | null;
                bestVenue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade" | null;
            }>;
            put: z.ZodObject<{
                venues: z.ZodRecord<z.ZodString, z.ZodObject<{
                    bid: z.ZodNullable<z.ZodNumber>;
                    ask: z.ZodNullable<z.ZodNumber>;
                    mid: z.ZodNullable<z.ZodNumber>;
                    bidSize: z.ZodNullable<z.ZodNumber>;
                    askSize: z.ZodNullable<z.ZodNumber>;
                    markIv: z.ZodNullable<z.ZodNumber>;
                    bidIv: z.ZodNullable<z.ZodNumber>;
                    askIv: z.ZodNullable<z.ZodNumber>;
                    delta: z.ZodNullable<z.ZodNumber>;
                    gamma: z.ZodNullable<z.ZodNumber>;
                    theta: z.ZodNullable<z.ZodNumber>;
                    vega: z.ZodNullable<z.ZodNumber>;
                    spreadPct: z.ZodNullable<z.ZodNumber>;
                    totalCost: z.ZodNullable<z.ZodNumber>;
                    estimatedFees: z.ZodNullable<z.ZodObject<{
                        maker: z.ZodNumber;
                        taker: z.ZodNumber;
                    }, "strip", z.ZodTypeAny, {
                        maker: number;
                        taker: number;
                    }, {
                        maker: number;
                        taker: number;
                    }>>;
                    openInterest: z.ZodNullable<z.ZodNumber>;
                    volume24h: z.ZodNullable<z.ZodNumber>;
                    openInterestUsd: z.ZodNullable<z.ZodNumber>;
                    volume24hUsd: z.ZodNullable<z.ZodNumber>;
                }, "strip", z.ZodTypeAny, {
                    bid: number | null;
                    ask: number | null;
                    mid: number | null;
                    bidSize: number | null;
                    askSize: number | null;
                    markIv: number | null;
                    bidIv: number | null;
                    askIv: number | null;
                    delta: number | null;
                    gamma: number | null;
                    theta: number | null;
                    vega: number | null;
                    spreadPct: number | null;
                    totalCost: number | null;
                    estimatedFees: {
                        maker: number;
                        taker: number;
                    } | null;
                    openInterest: number | null;
                    volume24h: number | null;
                    openInterestUsd: number | null;
                    volume24hUsd: number | null;
                }, {
                    bid: number | null;
                    ask: number | null;
                    mid: number | null;
                    bidSize: number | null;
                    askSize: number | null;
                    markIv: number | null;
                    bidIv: number | null;
                    askIv: number | null;
                    delta: number | null;
                    gamma: number | null;
                    theta: number | null;
                    vega: number | null;
                    spreadPct: number | null;
                    totalCost: number | null;
                    estimatedFees: {
                        maker: number;
                        taker: number;
                    } | null;
                    openInterest: number | null;
                    volume24h: number | null;
                    openInterestUsd: number | null;
                    volume24hUsd: number | null;
                }>>;
                bestIv: z.ZodNullable<z.ZodNumber>;
                bestVenue: z.ZodNullable<z.ZodEnum<["deribit", "okx", "bybit", "binance", "derive", "coincall", "thalex", "tastytrade"]>>;
            }, "strip", z.ZodTypeAny, {
                venues: Record<string, {
                    bid: number | null;
                    ask: number | null;
                    mid: number | null;
                    bidSize: number | null;
                    askSize: number | null;
                    markIv: number | null;
                    bidIv: number | null;
                    askIv: number | null;
                    delta: number | null;
                    gamma: number | null;
                    theta: number | null;
                    vega: number | null;
                    spreadPct: number | null;
                    totalCost: number | null;
                    estimatedFees: {
                        maker: number;
                        taker: number;
                    } | null;
                    openInterest: number | null;
                    volume24h: number | null;
                    openInterestUsd: number | null;
                    volume24hUsd: number | null;
                }>;
                bestIv: number | null;
                bestVenue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade" | null;
            }, {
                venues: Record<string, {
                    bid: number | null;
                    ask: number | null;
                    mid: number | null;
                    bidSize: number | null;
                    askSize: number | null;
                    markIv: number | null;
                    bidIv: number | null;
                    askIv: number | null;
                    delta: number | null;
                    gamma: number | null;
                    theta: number | null;
                    vega: number | null;
                    spreadPct: number | null;
                    totalCost: number | null;
                    estimatedFees: {
                        maker: number;
                        taker: number;
                    } | null;
                    openInterest: number | null;
                    volume24h: number | null;
                    openInterestUsd: number | null;
                    volume24hUsd: number | null;
                }>;
                bestIv: number | null;
                bestVenue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade" | null;
            }>;
        }, "strip", z.ZodTypeAny, {
            call: {
                venues: Record<string, {
                    bid: number | null;
                    ask: number | null;
                    mid: number | null;
                    bidSize: number | null;
                    askSize: number | null;
                    markIv: number | null;
                    bidIv: number | null;
                    askIv: number | null;
                    delta: number | null;
                    gamma: number | null;
                    theta: number | null;
                    vega: number | null;
                    spreadPct: number | null;
                    totalCost: number | null;
                    estimatedFees: {
                        maker: number;
                        taker: number;
                    } | null;
                    openInterest: number | null;
                    volume24h: number | null;
                    openInterestUsd: number | null;
                    volume24hUsd: number | null;
                }>;
                bestIv: number | null;
                bestVenue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade" | null;
            };
            put: {
                venues: Record<string, {
                    bid: number | null;
                    ask: number | null;
                    mid: number | null;
                    bidSize: number | null;
                    askSize: number | null;
                    markIv: number | null;
                    bidIv: number | null;
                    askIv: number | null;
                    delta: number | null;
                    gamma: number | null;
                    theta: number | null;
                    vega: number | null;
                    spreadPct: number | null;
                    totalCost: number | null;
                    estimatedFees: {
                        maker: number;
                        taker: number;
                    } | null;
                    openInterest: number | null;
                    volume24h: number | null;
                    openInterestUsd: number | null;
                    volume24hUsd: number | null;
                }>;
                bestIv: number | null;
                bestVenue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade" | null;
            };
            strike: number;
        }, {
            call: {
                venues: Record<string, {
                    bid: number | null;
                    ask: number | null;
                    mid: number | null;
                    bidSize: number | null;
                    askSize: number | null;
                    markIv: number | null;
                    bidIv: number | null;
                    askIv: number | null;
                    delta: number | null;
                    gamma: number | null;
                    theta: number | null;
                    vega: number | null;
                    spreadPct: number | null;
                    totalCost: number | null;
                    estimatedFees: {
                        maker: number;
                        taker: number;
                    } | null;
                    openInterest: number | null;
                    volume24h: number | null;
                    openInterestUsd: number | null;
                    volume24hUsd: number | null;
                }>;
                bestIv: number | null;
                bestVenue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade" | null;
            };
            put: {
                venues: Record<string, {
                    bid: number | null;
                    ask: number | null;
                    mid: number | null;
                    bidSize: number | null;
                    askSize: number | null;
                    markIv: number | null;
                    bidIv: number | null;
                    askIv: number | null;
                    delta: number | null;
                    gamma: number | null;
                    theta: number | null;
                    vega: number | null;
                    spreadPct: number | null;
                    totalCost: number | null;
                    estimatedFees: {
                        maker: number;
                        taker: number;
                    } | null;
                    openInterest: number | null;
                    volume24h: number | null;
                    openInterestUsd: number | null;
                    volume24hUsd: number | null;
                }>;
                bestIv: number | null;
                bestVenue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade" | null;
            };
            strike: number;
        }>, "many">;
        gex: z.ZodArray<z.ZodObject<{
            strike: z.ZodNumber;
            gexUsdMillions: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            strike: number;
            gexUsdMillions: number;
        }, {
            strike: number;
            gexUsdMillions: number;
        }>, "many">;
    }, "strip", z.ZodTypeAny, {
        stats: {
            forwardPriceUsd: number | null;
            indexPriceUsd: number | null;
            basisPct: number | null;
            atmStrike: number | null;
            atmIv: number | null;
            putCallOiRatio: number | null;
            totalOiUsd: number | null;
            skew25d: number | null;
            bfly25d: number | null;
        };
        strikes: {
            call: {
                venues: Record<string, {
                    bid: number | null;
                    ask: number | null;
                    mid: number | null;
                    bidSize: number | null;
                    askSize: number | null;
                    markIv: number | null;
                    bidIv: number | null;
                    askIv: number | null;
                    delta: number | null;
                    gamma: number | null;
                    theta: number | null;
                    vega: number | null;
                    spreadPct: number | null;
                    totalCost: number | null;
                    estimatedFees: {
                        maker: number;
                        taker: number;
                    } | null;
                    openInterest: number | null;
                    volume24h: number | null;
                    openInterestUsd: number | null;
                    volume24hUsd: number | null;
                }>;
                bestIv: number | null;
                bestVenue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade" | null;
            };
            put: {
                venues: Record<string, {
                    bid: number | null;
                    ask: number | null;
                    mid: number | null;
                    bidSize: number | null;
                    askSize: number | null;
                    markIv: number | null;
                    bidIv: number | null;
                    askIv: number | null;
                    delta: number | null;
                    gamma: number | null;
                    theta: number | null;
                    vega: number | null;
                    spreadPct: number | null;
                    totalCost: number | null;
                    estimatedFees: {
                        maker: number;
                        taker: number;
                    } | null;
                    openInterest: number | null;
                    volume24h: number | null;
                    openInterestUsd: number | null;
                    volume24hUsd: number | null;
                }>;
                bestIv: number | null;
                bestVenue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade" | null;
            };
            strike: number;
        }[];
        gex: {
            strike: number;
            gexUsdMillions: number;
        }[];
    }, {
        stats: {
            forwardPriceUsd: number | null;
            indexPriceUsd: number | null;
            basisPct: number | null;
            atmStrike: number | null;
            atmIv: number | null;
            putCallOiRatio: number | null;
            totalOiUsd: number | null;
            skew25d: number | null;
            bfly25d: number | null;
        };
        strikes: {
            call: {
                venues: Record<string, {
                    bid: number | null;
                    ask: number | null;
                    mid: number | null;
                    bidSize: number | null;
                    askSize: number | null;
                    markIv: number | null;
                    bidIv: number | null;
                    askIv: number | null;
                    delta: number | null;
                    gamma: number | null;
                    theta: number | null;
                    vega: number | null;
                    spreadPct: number | null;
                    totalCost: number | null;
                    estimatedFees: {
                        maker: number;
                        taker: number;
                    } | null;
                    openInterest: number | null;
                    volume24h: number | null;
                    openInterestUsd: number | null;
                    volume24hUsd: number | null;
                }>;
                bestIv: number | null;
                bestVenue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade" | null;
            };
            put: {
                venues: Record<string, {
                    bid: number | null;
                    ask: number | null;
                    mid: number | null;
                    bidSize: number | null;
                    askSize: number | null;
                    markIv: number | null;
                    bidIv: number | null;
                    askIv: number | null;
                    delta: number | null;
                    gamma: number | null;
                    theta: number | null;
                    vega: number | null;
                    spreadPct: number | null;
                    totalCost: number | null;
                    estimatedFees: {
                        maker: number;
                        taker: number;
                    } | null;
                    openInterest: number | null;
                    volume24h: number | null;
                    openInterestUsd: number | null;
                    volume24hUsd: number | null;
                }>;
                bestIv: number | null;
                bestVenue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade" | null;
            };
            strike: number;
        }[];
        gex: {
            strike: number;
            gexUsdMillions: number;
        }[];
    }>;
}, "strip", z.ZodTypeAny, {
    type: "delta";
    subscriptionId: string;
    request: {
        underlying: string;
        expiry: string;
        venues: ("deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade")[];
    };
    seq: number;
    meta: {
        generatedAt: number;
        maxQuoteTs: number;
        staleMs: number;
    };
    deltas: {
        symbol: string;
        venue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade";
        ts: number;
        quote?: {
            indexPriceUsd?: number | null | undefined;
            bid?: {
                raw?: number | null | undefined;
                rawCurrency?: string | undefined;
                usd?: number | null | undefined;
            } | undefined;
            ask?: {
                raw?: number | null | undefined;
                rawCurrency?: string | undefined;
                usd?: number | null | undefined;
            } | undefined;
            bidSize?: number | null | undefined;
            askSize?: number | null | undefined;
            estimatedFees?: {
                maker: number;
                taker: number;
            } | null | undefined;
            openInterest?: number | null | undefined;
            volume24h?: number | null | undefined;
            openInterestUsd?: number | null | undefined;
            volume24hUsd?: number | null | undefined;
            mark?: {
                raw?: number | null | undefined;
                rawCurrency?: string | undefined;
                usd?: number | null | undefined;
            } | undefined;
            last?: {
                raw?: number | null | undefined;
                rawCurrency?: string | undefined;
                usd?: number | null | undefined;
            } | null | undefined;
            underlyingPriceUsd?: number | null | undefined;
            timestamp?: number | null | undefined;
            source?: string | undefined;
        } | undefined;
        greeks?: {
            markIv?: number | null | undefined;
            bidIv?: number | null | undefined;
            askIv?: number | null | undefined;
            delta?: number | null | undefined;
            gamma?: number | null | undefined;
            theta?: number | null | undefined;
            vega?: number | null | undefined;
            rho?: number | null | undefined;
        } | undefined;
    }[];
    patch: {
        stats: {
            forwardPriceUsd: number | null;
            indexPriceUsd: number | null;
            basisPct: number | null;
            atmStrike: number | null;
            atmIv: number | null;
            putCallOiRatio: number | null;
            totalOiUsd: number | null;
            skew25d: number | null;
            bfly25d: number | null;
        };
        strikes: {
            call: {
                venues: Record<string, {
                    bid: number | null;
                    ask: number | null;
                    mid: number | null;
                    bidSize: number | null;
                    askSize: number | null;
                    markIv: number | null;
                    bidIv: number | null;
                    askIv: number | null;
                    delta: number | null;
                    gamma: number | null;
                    theta: number | null;
                    vega: number | null;
                    spreadPct: number | null;
                    totalCost: number | null;
                    estimatedFees: {
                        maker: number;
                        taker: number;
                    } | null;
                    openInterest: number | null;
                    volume24h: number | null;
                    openInterestUsd: number | null;
                    volume24hUsd: number | null;
                }>;
                bestIv: number | null;
                bestVenue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade" | null;
            };
            put: {
                venues: Record<string, {
                    bid: number | null;
                    ask: number | null;
                    mid: number | null;
                    bidSize: number | null;
                    askSize: number | null;
                    markIv: number | null;
                    bidIv: number | null;
                    askIv: number | null;
                    delta: number | null;
                    gamma: number | null;
                    theta: number | null;
                    vega: number | null;
                    spreadPct: number | null;
                    totalCost: number | null;
                    estimatedFees: {
                        maker: number;
                        taker: number;
                    } | null;
                    openInterest: number | null;
                    volume24h: number | null;
                    openInterestUsd: number | null;
                    volume24hUsd: number | null;
                }>;
                bestIv: number | null;
                bestVenue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade" | null;
            };
            strike: number;
        }[];
        gex: {
            strike: number;
            gexUsdMillions: number;
        }[];
    };
}, {
    type: "delta";
    subscriptionId: string;
    request: {
        underlying: string;
        expiry: string;
        venues: ("deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade")[];
    };
    seq: number;
    meta: {
        generatedAt: number;
        maxQuoteTs: number;
        staleMs: number;
    };
    deltas: {
        symbol: string;
        venue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade";
        ts: number;
        quote?: {
            indexPriceUsd?: number | null | undefined;
            bid?: {
                raw?: number | null | undefined;
                rawCurrency?: string | undefined;
                usd?: number | null | undefined;
            } | undefined;
            ask?: {
                raw?: number | null | undefined;
                rawCurrency?: string | undefined;
                usd?: number | null | undefined;
            } | undefined;
            bidSize?: number | null | undefined;
            askSize?: number | null | undefined;
            estimatedFees?: {
                maker: number;
                taker: number;
            } | null | undefined;
            openInterest?: number | null | undefined;
            volume24h?: number | null | undefined;
            openInterestUsd?: number | null | undefined;
            volume24hUsd?: number | null | undefined;
            mark?: {
                raw?: number | null | undefined;
                rawCurrency?: string | undefined;
                usd?: number | null | undefined;
            } | undefined;
            last?: {
                raw?: number | null | undefined;
                rawCurrency?: string | undefined;
                usd?: number | null | undefined;
            } | null | undefined;
            underlyingPriceUsd?: number | null | undefined;
            timestamp?: number | null | undefined;
            source?: string | undefined;
        } | undefined;
        greeks?: {
            markIv?: number | null | undefined;
            bidIv?: number | null | undefined;
            askIv?: number | null | undefined;
            delta?: number | null | undefined;
            gamma?: number | null | undefined;
            theta?: number | null | undefined;
            vega?: number | null | undefined;
            rho?: number | null | undefined;
        } | undefined;
    }[];
    patch: {
        stats: {
            forwardPriceUsd: number | null;
            indexPriceUsd: number | null;
            basisPct: number | null;
            atmStrike: number | null;
            atmIv: number | null;
            putCallOiRatio: number | null;
            totalOiUsd: number | null;
            skew25d: number | null;
            bfly25d: number | null;
        };
        strikes: {
            call: {
                venues: Record<string, {
                    bid: number | null;
                    ask: number | null;
                    mid: number | null;
                    bidSize: number | null;
                    askSize: number | null;
                    markIv: number | null;
                    bidIv: number | null;
                    askIv: number | null;
                    delta: number | null;
                    gamma: number | null;
                    theta: number | null;
                    vega: number | null;
                    spreadPct: number | null;
                    totalCost: number | null;
                    estimatedFees: {
                        maker: number;
                        taker: number;
                    } | null;
                    openInterest: number | null;
                    volume24h: number | null;
                    openInterestUsd: number | null;
                    volume24hUsd: number | null;
                }>;
                bestIv: number | null;
                bestVenue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade" | null;
            };
            put: {
                venues: Record<string, {
                    bid: number | null;
                    ask: number | null;
                    mid: number | null;
                    bidSize: number | null;
                    askSize: number | null;
                    markIv: number | null;
                    bidIv: number | null;
                    askIv: number | null;
                    delta: number | null;
                    gamma: number | null;
                    theta: number | null;
                    vega: number | null;
                    spreadPct: number | null;
                    totalCost: number | null;
                    estimatedFees: {
                        maker: number;
                        taker: number;
                    } | null;
                    openInterest: number | null;
                    volume24h: number | null;
                    openInterestUsd: number | null;
                    volume24hUsd: number | null;
                }>;
                bestIv: number | null;
                bestVenue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade" | null;
            };
            strike: number;
        }[];
        gex: {
            strike: number;
            gexUsdMillions: number;
        }[];
    };
}>, z.ZodObject<{
    type: z.ZodLiteral<"status">;
    subscriptionId: z.ZodString;
    venue: z.ZodEnum<["deribit", "okx", "bybit", "binance", "derive", "coincall", "thalex", "tastytrade"]>;
    state: z.ZodEnum<["connected", "polling", "reconnecting", "degraded", "down"]>;
    ts: z.ZodNumber;
    message: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "status";
    venue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade";
    subscriptionId: string;
    ts: number;
    state: "connected" | "polling" | "reconnecting" | "degraded" | "down";
    message?: string | undefined;
}, {
    type: "status";
    venue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "tastytrade";
    subscriptionId: string;
    ts: number;
    state: "connected" | "polling" | "reconnecting" | "degraded" | "down";
    message?: string | undefined;
}>, z.ZodObject<{
    type: z.ZodLiteral<"error">;
    subscriptionId: z.ZodNullable<z.ZodString>;
    code: z.ZodString;
    message: z.ZodString;
    retryable: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    code: string;
    message: string;
    type: "error";
    subscriptionId: string | null;
    retryable: boolean;
}, {
    code: string;
    message: string;
    type: "error";
    subscriptionId: string | null;
    retryable: boolean;
}>]>;
export type ServerWsMessage = z.infer<typeof ServerWsMessageSchema>;
//# sourceMappingURL=ws.d.ts.map