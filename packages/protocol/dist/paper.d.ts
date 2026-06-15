import { z } from 'zod';
export declare const PAPER_VENUE_IDS: readonly ["deribit", "okx", "bybit", "binance", "derive", "coincall", "thalex"];
export type PaperVenueId = (typeof PAPER_VENUE_IDS)[number];
export declare const PaperVenueIdSchema: z.ZodEnum<["deribit", "okx", "bybit", "binance", "derive", "coincall", "thalex"]>;
export declare const PaperOrderLegSchema: z.ZodObject<{
    index: z.ZodNumber;
    side: z.ZodEnum<["buy", "sell"]>;
    optionRight: z.ZodEnum<["call", "put"]>;
    underlying: z.ZodString;
    expiry: z.ZodString;
    strike: z.ZodNumber;
    quantity: z.ZodNumber;
    preferredVenues: z.ZodNullable<z.ZodArray<z.ZodEnum<["deribit", "okx", "bybit", "binance", "derive", "coincall", "thalex"]>, "many">>;
}, "strip", z.ZodTypeAny, {
    index: number;
    side: "buy" | "sell";
    optionRight: "call" | "put";
    underlying: string;
    expiry: string;
    strike: number;
    quantity: number;
    preferredVenues: ("deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex")[] | null;
}, {
    index: number;
    side: "buy" | "sell";
    optionRight: "call" | "put";
    underlying: string;
    expiry: string;
    strike: number;
    quantity: number;
    preferredVenues: ("deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex")[] | null;
}>;
export type PaperOrderLeg = z.infer<typeof PaperOrderLegSchema>;
export declare const PlaceOrderRequestSchema: z.ZodObject<{
    clientOrderId: z.ZodOptional<z.ZodString>;
    legs: z.ZodArray<z.ZodObject<{
        side: z.ZodEnum<["buy", "sell"]>;
        optionRight: z.ZodEnum<["call", "put"]>;
        underlying: z.ZodString;
        expiry: z.ZodString;
        strike: z.ZodNumber;
        quantity: z.ZodNumber;
    } & {
        preferredVenues: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodEnum<["deribit", "okx", "bybit", "binance", "derive", "coincall", "thalex"]>, "many">>>;
    }, "strip", z.ZodTypeAny, {
        side: "buy" | "sell";
        optionRight: "call" | "put";
        underlying: string;
        expiry: string;
        strike: number;
        quantity: number;
        preferredVenues?: ("deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex")[] | null | undefined;
    }, {
        side: "buy" | "sell";
        optionRight: "call" | "put";
        underlying: string;
        expiry: string;
        strike: number;
        quantity: number;
        preferredVenues?: ("deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex")[] | null | undefined;
    }>, "many">;
    venueFilter: z.ZodDefault<z.ZodArray<z.ZodEnum<["deribit", "okx", "bybit", "binance", "derive", "coincall", "thalex"]>, "many">>;
}, "strip", z.ZodTypeAny, {
    legs: {
        side: "buy" | "sell";
        optionRight: "call" | "put";
        underlying: string;
        expiry: string;
        strike: number;
        quantity: number;
        preferredVenues?: ("deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex")[] | null | undefined;
    }[];
    venueFilter: ("deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex")[];
    clientOrderId?: string | undefined;
}, {
    legs: {
        side: "buy" | "sell";
        optionRight: "call" | "put";
        underlying: string;
        expiry: string;
        strike: number;
        quantity: number;
        preferredVenues?: ("deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex")[] | null | undefined;
    }[];
    clientOrderId?: string | undefined;
    venueFilter?: ("deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex")[] | undefined;
}>;
export type PlaceOrderRequest = z.infer<typeof PlaceOrderRequestSchema>;
export declare const PaperTradeStatusSchema: z.ZodEnum<["open", "closed"]>;
export declare const PaperTradeOrderIntentSchema: z.ZodEnum<["open", "add", "reduce", "close", "roll", "settlement"]>;
export declare const PaperTradeNoteKindSchema: z.ZodEnum<["thesis", "invalidation", "review", "note"]>;
export declare const CreatePaperTradeRequestSchema: z.ZodObject<{
    label: z.ZodOptional<z.ZodString>;
    strategyName: z.ZodOptional<z.ZodString>;
    thesis: z.ZodOptional<z.ZodString>;
    invalidation: z.ZodOptional<z.ZodString>;
    order: z.ZodObject<{
        clientOrderId: z.ZodOptional<z.ZodString>;
        legs: z.ZodArray<z.ZodObject<{
            side: z.ZodEnum<["buy", "sell"]>;
            optionRight: z.ZodEnum<["call", "put"]>;
            underlying: z.ZodString;
            expiry: z.ZodString;
            strike: z.ZodNumber;
            quantity: z.ZodNumber;
        } & {
            preferredVenues: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodEnum<["deribit", "okx", "bybit", "binance", "derive", "coincall", "thalex"]>, "many">>>;
        }, "strip", z.ZodTypeAny, {
            side: "buy" | "sell";
            optionRight: "call" | "put";
            underlying: string;
            expiry: string;
            strike: number;
            quantity: number;
            preferredVenues?: ("deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex")[] | null | undefined;
        }, {
            side: "buy" | "sell";
            optionRight: "call" | "put";
            underlying: string;
            expiry: string;
            strike: number;
            quantity: number;
            preferredVenues?: ("deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex")[] | null | undefined;
        }>, "many">;
        venueFilter: z.ZodDefault<z.ZodArray<z.ZodEnum<["deribit", "okx", "bybit", "binance", "derive", "coincall", "thalex"]>, "many">>;
    }, "strip", z.ZodTypeAny, {
        legs: {
            side: "buy" | "sell";
            optionRight: "call" | "put";
            underlying: string;
            expiry: string;
            strike: number;
            quantity: number;
            preferredVenues?: ("deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex")[] | null | undefined;
        }[];
        venueFilter: ("deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex")[];
        clientOrderId?: string | undefined;
    }, {
        legs: {
            side: "buy" | "sell";
            optionRight: "call" | "put";
            underlying: string;
            expiry: string;
            strike: number;
            quantity: number;
            preferredVenues?: ("deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex")[] | null | undefined;
        }[];
        clientOrderId?: string | undefined;
        venueFilter?: ("deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex")[] | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    order: {
        legs: {
            side: "buy" | "sell";
            optionRight: "call" | "put";
            underlying: string;
            expiry: string;
            strike: number;
            quantity: number;
            preferredVenues?: ("deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex")[] | null | undefined;
        }[];
        venueFilter: ("deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex")[];
        clientOrderId?: string | undefined;
    };
    thesis?: string | undefined;
    invalidation?: string | undefined;
    label?: string | undefined;
    strategyName?: string | undefined;
}, {
    order: {
        legs: {
            side: "buy" | "sell";
            optionRight: "call" | "put";
            underlying: string;
            expiry: string;
            strike: number;
            quantity: number;
            preferredVenues?: ("deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex")[] | null | undefined;
        }[];
        clientOrderId?: string | undefined;
        venueFilter?: ("deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex")[] | undefined;
    };
    thesis?: string | undefined;
    invalidation?: string | undefined;
    label?: string | undefined;
    strategyName?: string | undefined;
}>;
export type CreatePaperTradeRequest = z.infer<typeof CreatePaperTradeRequestSchema>;
export declare const CreatePaperTradeNoteRequestSchema: z.ZodObject<{
    kind: z.ZodEnum<["thesis", "invalidation", "review", "note"]>;
    content: z.ZodString;
    tags: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    kind: "thesis" | "invalidation" | "review" | "note";
    content: string;
    tags: string[];
}, {
    kind: "thesis" | "invalidation" | "review" | "note";
    content: string;
    tags?: string[] | undefined;
}>;
export type CreatePaperTradeNoteRequest = z.infer<typeof CreatePaperTradeNoteRequestSchema>;
export declare const ReducePaperTradeRequestSchema: z.ZodObject<{
    fraction: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    fraction: number;
}, {
    fraction: number;
}>;
export type ReducePaperTradeRequest = z.infer<typeof ReducePaperTradeRequestSchema>;
export declare const InitPaperAccountRequestSchema: z.ZodObject<{
    initialCashUsd: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    initialCashUsd: number;
}, {
    initialCashUsd: number;
}>;
export type InitPaperAccountRequest = z.infer<typeof InitPaperAccountRequestSchema>;
export interface PaperOrderDto {
    id: string;
    clientOrderId: string;
    accountId: string;
    status: 'accepted' | 'filled' | 'rejected' | 'cancelled';
    legs: PaperOrderLeg[];
    submittedAt: string;
    filledAt: string | null;
    rejectionReason: string | null;
    totalDebitUsd: number | null;
}
export interface PaperFillDto {
    id: string;
    orderId: string;
    legIndex: number;
    venue: string;
    side: 'buy' | 'sell';
    optionRight: 'call' | 'put';
    underlying: string;
    expiry: string;
    strike: number;
    quantity: number;
    requestedQuantity: number;
    priceUsd: number;
    feesUsd: number;
    slippageUsd: number;
    partialFill: boolean;
    benchmarkBidUsd: number | null;
    benchmarkAskUsd: number | null;
    benchmarkMidUsd: number | null;
    underlyingSpotUsd: number | null;
    filledAt: string;
}
export interface PaperPositionDto {
    underlying: string;
    expiry: string;
    strike: number;
    optionRight: 'call' | 'put';
    netQuantity: number;
    avgEntryPriceUsd: number;
    realizedPnlUsd: number;
    markPriceUsd: number | null;
    unrealizedPnlUsd: number | null;
    openedAt: string;
    lastFillAt: string;
}
export interface PaperPnlDto {
    cashUsd: number;
    realizedUsd: number;
    unrealizedUsd: number;
    equityUsd: number;
    generatedAt: string;
}
export interface PaperAccountDto {
    id: string;
    label: string;
    initialCashUsd: number;
    createdAt: string | null;
    isInitialized: boolean;
}
export interface PaperRiskDto {
    delta: number | null;
    gamma: number | null;
    theta: number | null;
    vega: number | null;
}
export interface PaperTradeLegDto extends PaperPositionDto {
    delta: number | null;
    gamma: number | null;
    theta: number | null;
    vega: number | null;
    markIv: number | null;
    underlyingPriceUsd: number | null;
    marketSourceVenue: string | null;
    marketSourceLabel: string;
}
export interface PaperTradeNoteDto {
    id: string;
    tradeId: string;
    kind: z.infer<typeof PaperTradeNoteKindSchema>;
    content: string;
    tags: string[];
    createdAt: string;
}
export interface PaperActivityDto {
    id: string;
    tradeId: string | null;
    kind: string;
    summary: string;
    payload: unknown;
    ts: string;
}
export interface PaperTradeOrderLinkDto {
    intent: z.infer<typeof PaperTradeOrderIntentSchema>;
    order: PaperOrderDto;
}
export interface PaperTradeSummaryDto {
    id: string;
    accountId: string;
    underlying: string;
    label: string;
    strategyName: string;
    status: z.infer<typeof PaperTradeStatusSchema>;
    entrySpotUsd: number | null;
    currentSpotUsd: number | null;
    openedAt: string;
    closedAt: string | null;
    netPremiumUsd: number;
    realizedPnlUsd: number;
    unrealizedPnlUsd: number;
    totalPnlUsd: number;
    openLegs: number;
    risk: PaperRiskDto;
}
export interface PaperTradeDetailDto extends PaperTradeSummaryDto {
    legs: PaperTradeLegDto[];
    orders: PaperTradeOrderLinkDto[];
    fills: PaperFillDto[];
    notes: PaperTradeNoteDto[];
    activity: PaperActivityDto[];
}
export interface PaperOverviewDto {
    pnl: PaperPnlDto;
    risk: PaperRiskDto;
    openTradeCount: number;
    closedTradeCount: number;
}
export type PaperWsServerMessage = {
    type: 'hello';
    accountId: string;
    serverTime: number;
} | {
    type: 'positions';
    positions: PaperPositionDto[];
} | {
    type: 'pnl';
    pnl: PaperPnlDto;
} | {
    type: 'order';
    order: PaperOrderDto;
    fills: PaperFillDto[];
} | {
    type: 'trade';
    trade: PaperTradeDetailDto;
} | {
    type: 'activity';
    activity: PaperActivityDto;
} | {
    type: 'error';
    code: string;
    message: string;
};
//# sourceMappingURL=paper.d.ts.map