import { z } from 'zod';
export declare const PositionSourceSchema: z.ZodEnum<["manual", "paper", "deribit", "okx", "binance", "bybit", "derive", "coincall", "thalex", "gateio"]>;
export type PositionSource = z.infer<typeof PositionSourceSchema>;
export declare const PortfolioSourceSchema: z.ZodEnum<["manual", "paper", "deribit", "okx", "binance", "bybit", "derive", "coincall", "thalex", "gateio"]>;
export type PortfolioSource = z.infer<typeof PortfolioSourceSchema>;
export declare const PositionLegSchema: z.ZodObject<{
    legId: z.ZodString;
    underlying: z.ZodString;
    expiry: z.ZodString;
    strike: z.ZodNumber;
    optionRight: z.ZodEnum<["call", "put"]>;
    size: z.ZodEffects<z.ZodNumber, number, number>;
    entryPriceUsd: z.ZodNumber;
    entryIv: z.ZodNullable<z.ZodNumber>;
    entryIvIsModel: z.ZodOptional<z.ZodBoolean>;
    realizedPnlUsd: z.ZodDefault<z.ZodNumber>;
    entryTs: z.ZodNumber;
    venueHint: z.ZodNullable<z.ZodEnum<["deribit", "okx", "bybit", "binance", "derive", "coincall", "thalex", "gateio", "paradex"]>>;
    source: z.ZodEnum<["manual", "paper", "deribit", "okx", "binance", "bybit", "derive", "coincall", "thalex", "gateio"]>;
}, "strip", z.ZodTypeAny, {
    underlying: string;
    expiry: string;
    strike: number;
    source: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "gateio" | "manual" | "paper";
    legId: string;
    optionRight: "call" | "put";
    size: number;
    entryPriceUsd: number;
    entryIv: number | null;
    realizedPnlUsd: number;
    entryTs: number;
    venueHint: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "gateio" | "paradex" | null;
    entryIvIsModel?: boolean | undefined;
}, {
    underlying: string;
    expiry: string;
    strike: number;
    source: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "gateio" | "manual" | "paper";
    legId: string;
    optionRight: "call" | "put";
    size: number;
    entryPriceUsd: number;
    entryIv: number | null;
    entryTs: number;
    venueHint: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "gateio" | "paradex" | null;
    entryIvIsModel?: boolean | undefined;
    realizedPnlUsd?: number | undefined;
}>;
export type PositionLeg = z.infer<typeof PositionLegSchema>;
export declare const PositionLegInputSchema: z.ZodObject<Omit<{
    legId: z.ZodString;
    underlying: z.ZodString;
    expiry: z.ZodString;
    strike: z.ZodNumber;
    optionRight: z.ZodEnum<["call", "put"]>;
    size: z.ZodEffects<z.ZodNumber, number, number>;
    entryPriceUsd: z.ZodNumber;
    entryIv: z.ZodNullable<z.ZodNumber>;
    entryIvIsModel: z.ZodOptional<z.ZodBoolean>;
    realizedPnlUsd: z.ZodDefault<z.ZodNumber>;
    entryTs: z.ZodNumber;
    venueHint: z.ZodNullable<z.ZodEnum<["deribit", "okx", "bybit", "binance", "derive", "coincall", "thalex", "gateio", "paradex"]>>;
    source: z.ZodEnum<["manual", "paper", "deribit", "okx", "binance", "bybit", "derive", "coincall", "thalex", "gateio"]>;
}, "legId" | "entryIvIsModel" | "realizedPnlUsd" | "entryTs"> & {
    legId: z.ZodOptional<z.ZodString>;
    entryTs: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    underlying: string;
    expiry: string;
    strike: number;
    source: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "gateio" | "manual" | "paper";
    optionRight: "call" | "put";
    size: number;
    entryPriceUsd: number;
    entryIv: number | null;
    venueHint: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "gateio" | "paradex" | null;
    legId?: string | undefined;
    entryTs?: number | undefined;
}, {
    underlying: string;
    expiry: string;
    strike: number;
    source: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "gateio" | "manual" | "paper";
    optionRight: "call" | "put";
    size: number;
    entryPriceUsd: number;
    entryIv: number | null;
    venueHint: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "gateio" | "paradex" | null;
    legId?: string | undefined;
    entryTs?: number | undefined;
}>;
export type PositionLegInput = z.infer<typeof PositionLegInputSchema>;
export declare const VegaByStrikeRowSchema: z.ZodObject<{
    strike: z.ZodNumber;
    expiry: z.ZodString;
    optionRight: z.ZodEnum<["call", "put"]>;
    delta: z.ZodNumber;
    vega: z.ZodNumber;
    gamma: z.ZodNumber;
    vanna: z.ZodNumber;
    volga: z.ZodNumber;
    contracts: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    expiry: string;
    strike: number;
    delta: number;
    gamma: number;
    vega: number;
    optionRight: "call" | "put";
    vanna: number;
    volga: number;
    contracts: number;
}, {
    expiry: string;
    strike: number;
    delta: number;
    gamma: number;
    vega: number;
    optionRight: "call" | "put";
    vanna: number;
    volga: number;
    contracts: number;
}>;
export type VegaByStrikeRow = z.infer<typeof VegaByStrikeRowSchema>;
export declare const ExpiryBucketRowSchema: z.ZodObject<{
    expiry: z.ZodString;
    dte: z.ZodNumber;
    vega: z.ZodNumber;
    gamma: z.ZodNumber;
    theta: z.ZodNumber;
    contracts: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    expiry: string;
    dte: number;
    gamma: number;
    theta: number;
    vega: number;
    contracts: number;
}, {
    expiry: string;
    dte: number;
    gamma: number;
    theta: number;
    vega: number;
    contracts: number;
}>;
export type ExpiryBucketRow = z.infer<typeof ExpiryBucketRowSchema>;
export declare const BreakEvenIvRowSchema: z.ZodObject<{
    legId: z.ZodString;
    strike: z.ZodNumber;
    expiry: z.ZodString;
    optionRight: z.ZodEnum<["call", "put"]>;
    entryIv: z.ZodNullable<z.ZodNumber>;
    currentMarkUsd: z.ZodNullable<z.ZodNumber>;
    currentIv: z.ZodNullable<z.ZodNumber>;
    breakEvenIv: z.ZodNullable<z.ZodNumber>;
    ivCushionPct: z.ZodNullable<z.ZodNumber>;
    currentIvIsModel: z.ZodOptional<z.ZodBoolean>;
    beNote: z.ZodOptional<z.ZodEnum<["capped", "below_intrinsic", "above_upper"]>>;
}, "strip", z.ZodTypeAny, {
    expiry: string;
    strike: number;
    legId: string;
    optionRight: "call" | "put";
    entryIv: number | null;
    currentMarkUsd: number | null;
    currentIv: number | null;
    breakEvenIv: number | null;
    ivCushionPct: number | null;
    currentIvIsModel?: boolean | undefined;
    beNote?: "capped" | "below_intrinsic" | "above_upper" | undefined;
}, {
    expiry: string;
    strike: number;
    legId: string;
    optionRight: "call" | "put";
    entryIv: number | null;
    currentMarkUsd: number | null;
    currentIv: number | null;
    breakEvenIv: number | null;
    ivCushionPct: number | null;
    currentIvIsModel?: boolean | undefined;
    beNote?: "capped" | "below_intrinsic" | "above_upper" | undefined;
}>;
export type BreakEvenIvRow = z.infer<typeof BreakEvenIvRowSchema>;
export declare const VolShockScenarioSchema: z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
    kind: z.ZodLiteral<"parallel">;
    bumpVolPts: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    kind: "parallel";
    bumpVolPts: number;
}, {
    kind: "parallel";
    bumpVolPts: number;
}>, z.ZodObject<{
    kind: z.ZodLiteral<"skew_tilt">;
    atmStrike: z.ZodNumber;
    slopePerLogK: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    atmStrike: number;
    kind: "skew_tilt";
    slopePerLogK: number;
}, {
    atmStrike: number;
    kind: "skew_tilt";
    slopePerLogK: number;
}>, z.ZodObject<{
    kind: z.ZodLiteral<"term_twist">;
    pivotDays: z.ZodNumber;
    slopePerYear: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    kind: "term_twist";
    pivotDays: number;
    slopePerYear: number;
}, {
    kind: "term_twist";
    pivotDays: number;
    slopePerYear: number;
}>, z.ZodObject<{
    kind: z.ZodLiteral<"atm_bump">;
    atmStrike: z.ZodNumber;
    widthPct: z.ZodNumber;
    bumpVolPts: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    atmStrike: number;
    kind: "atm_bump";
    bumpVolPts: number;
    widthPct: number;
}, {
    atmStrike: number;
    kind: "atm_bump";
    bumpVolPts: number;
    widthPct: number;
}>]>;
export type VolShockScenario = z.infer<typeof VolShockScenarioSchema>;
export declare const VolShockLegResultSchema: z.ZodObject<{
    legId: z.ZodString;
    pnlUsd: z.ZodNumber;
    bumpedIv: z.ZodNumber;
    bumpedMarkUsd: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    legId: string;
    pnlUsd: number;
    bumpedIv: number;
    bumpedMarkUsd: number;
}, {
    legId: string;
    pnlUsd: number;
    bumpedIv: number;
    bumpedMarkUsd: number;
}>;
export type VolShockLegResult = z.infer<typeof VolShockLegResultSchema>;
export declare const VolShockResultSchema: z.ZodObject<{
    scenario: z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
        kind: z.ZodLiteral<"parallel">;
        bumpVolPts: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        kind: "parallel";
        bumpVolPts: number;
    }, {
        kind: "parallel";
        bumpVolPts: number;
    }>, z.ZodObject<{
        kind: z.ZodLiteral<"skew_tilt">;
        atmStrike: z.ZodNumber;
        slopePerLogK: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        atmStrike: number;
        kind: "skew_tilt";
        slopePerLogK: number;
    }, {
        atmStrike: number;
        kind: "skew_tilt";
        slopePerLogK: number;
    }>, z.ZodObject<{
        kind: z.ZodLiteral<"term_twist">;
        pivotDays: z.ZodNumber;
        slopePerYear: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        kind: "term_twist";
        pivotDays: number;
        slopePerYear: number;
    }, {
        kind: "term_twist";
        pivotDays: number;
        slopePerYear: number;
    }>, z.ZodObject<{
        kind: z.ZodLiteral<"atm_bump">;
        atmStrike: z.ZodNumber;
        widthPct: z.ZodNumber;
        bumpVolPts: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        atmStrike: number;
        kind: "atm_bump";
        bumpVolPts: number;
        widthPct: number;
    }, {
        atmStrike: number;
        kind: "atm_bump";
        bumpVolPts: number;
        widthPct: number;
    }>]>;
    totalPnlUsd: z.ZodNumber;
    byLeg: z.ZodArray<z.ZodObject<{
        legId: z.ZodString;
        pnlUsd: z.ZodNumber;
        bumpedIv: z.ZodNumber;
        bumpedMarkUsd: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        legId: string;
        pnlUsd: number;
        bumpedIv: number;
        bumpedMarkUsd: number;
    }, {
        legId: string;
        pnlUsd: number;
        bumpedIv: number;
        bumpedMarkUsd: number;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    scenario: {
        kind: "parallel";
        bumpVolPts: number;
    } | {
        atmStrike: number;
        kind: "skew_tilt";
        slopePerLogK: number;
    } | {
        kind: "term_twist";
        pivotDays: number;
        slopePerYear: number;
    } | {
        atmStrike: number;
        kind: "atm_bump";
        bumpVolPts: number;
        widthPct: number;
    };
    totalPnlUsd: number;
    byLeg: {
        legId: string;
        pnlUsd: number;
        bumpedIv: number;
        bumpedMarkUsd: number;
    }[];
}, {
    scenario: {
        kind: "parallel";
        bumpVolPts: number;
    } | {
        atmStrike: number;
        kind: "skew_tilt";
        slopePerLogK: number;
    } | {
        kind: "term_twist";
        pivotDays: number;
        slopePerYear: number;
    } | {
        atmStrike: number;
        kind: "atm_bump";
        bumpVolPts: number;
        widthPct: number;
    };
    totalPnlUsd: number;
    byLeg: {
        legId: string;
        pnlUsd: number;
        bumpedIv: number;
        bumpedMarkUsd: number;
    }[];
}>;
export type VolShockResult = z.infer<typeof VolShockResultSchema>;
export declare const PortfolioTotalsSchema: z.ZodObject<{
    netDeltaUsd: z.ZodNumber;
    netGammaUsd: z.ZodNumber;
    netVegaUsd: z.ZodNumber;
    netThetaUsd: z.ZodNumber;
    netVannaUsd: z.ZodNumber;
    netVolgaUsd: z.ZodNumber;
    unrealizedPnlUsd: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    netDeltaUsd: number;
    netGammaUsd: number;
    netVegaUsd: number;
    netThetaUsd: number;
    netVannaUsd: number;
    netVolgaUsd: number;
    unrealizedPnlUsd: number;
}, {
    netDeltaUsd: number;
    netGammaUsd: number;
    netVegaUsd: number;
    netThetaUsd: number;
    netVannaUsd: number;
    netVolgaUsd: number;
    unrealizedPnlUsd: number;
}>;
export type PortfolioTotals = z.infer<typeof PortfolioTotalsSchema>;
export declare const ShockGridCellSchema: z.ZodObject<{
    atmShiftVolPts: z.ZodNumber;
    skewShiftPerLogK: z.ZodNumber;
    totalPnlUsd: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    totalPnlUsd: number;
    atmShiftVolPts: number;
    skewShiftPerLogK: number;
}, {
    totalPnlUsd: number;
    atmShiftVolPts: number;
    skewShiftPerLogK: number;
}>;
export type ShockGridCell = z.infer<typeof ShockGridCellSchema>;
export declare const PortfolioPnlCurveStatusSchema: z.ZodEnum<["ok", "empty", "mixed_underlyings", "missing_marks"]>;
export type PortfolioPnlCurveStatus = z.infer<typeof PortfolioPnlCurveStatusSchema>;
export declare const PortfolioPnlPointSchema: z.ZodObject<{
    underlyingPriceUsd: z.ZodNumber;
    nowPnlUsd: z.ZodNumber;
    forwardPnlUsd: z.ZodNullable<z.ZodNumber>;
    expiryPnlUsd: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    underlyingPriceUsd: number;
    nowPnlUsd: number;
    forwardPnlUsd: number | null;
    expiryPnlUsd: number;
}, {
    underlyingPriceUsd: number;
    nowPnlUsd: number;
    forwardPnlUsd: number | null;
    expiryPnlUsd: number;
}>;
export type PortfolioPnlPoint = z.infer<typeof PortfolioPnlPointSchema>;
export declare const PortfolioPnlCurveSchema: z.ZodObject<{
    status: z.ZodEnum<["ok", "empty", "mixed_underlyings", "missing_marks"]>;
    underlying: z.ZodNullable<z.ZodString>;
    currentSpotUsd: z.ZodNullable<z.ZodNumber>;
    breakEvenPricesUsd: z.ZodArray<z.ZodNumber, "many">;
    maxProfitUsd: z.ZodNullable<z.ZodNumber>;
    maxLossUsd: z.ZodNullable<z.ZodNumber>;
    upsideBounded: z.ZodBoolean;
    downsideBounded: z.ZodBoolean;
    points: z.ZodArray<z.ZodObject<{
        underlyingPriceUsd: z.ZodNumber;
        nowPnlUsd: z.ZodNumber;
        forwardPnlUsd: z.ZodNullable<z.ZodNumber>;
        expiryPnlUsd: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        underlyingPriceUsd: number;
        nowPnlUsd: number;
        forwardPnlUsd: number | null;
        expiryPnlUsd: number;
    }, {
        underlyingPriceUsd: number;
        nowPnlUsd: number;
        forwardPnlUsd: number | null;
        expiryPnlUsd: number;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    underlying: string | null;
    status: "ok" | "empty" | "mixed_underlyings" | "missing_marks";
    currentSpotUsd: number | null;
    breakEvenPricesUsd: number[];
    maxProfitUsd: number | null;
    maxLossUsd: number | null;
    upsideBounded: boolean;
    downsideBounded: boolean;
    points: {
        underlyingPriceUsd: number;
        nowPnlUsd: number;
        forwardPnlUsd: number | null;
        expiryPnlUsd: number;
    }[];
}, {
    underlying: string | null;
    status: "ok" | "empty" | "mixed_underlyings" | "missing_marks";
    currentSpotUsd: number | null;
    breakEvenPricesUsd: number[];
    maxProfitUsd: number | null;
    maxLossUsd: number | null;
    upsideBounded: boolean;
    downsideBounded: boolean;
    points: {
        underlyingPriceUsd: number;
        nowPnlUsd: number;
        forwardPnlUsd: number | null;
        expiryPnlUsd: number;
    }[];
}>;
export type PortfolioPnlCurve = z.infer<typeof PortfolioPnlCurveSchema>;
export declare const StrategyKindSchema: z.ZodEnum<["naked", "call_spread", "put_spread", "straddle", "strangle"]>;
export type StrategyKind = z.infer<typeof StrategyKindSchema>;
export declare const StrategyGroupSchema: z.ZodObject<{
    groupId: z.ZodString;
    kind: z.ZodEnum<["naked", "call_spread", "put_spread", "straddle", "strangle"]>;
    underlying: z.ZodString;
    expiry: z.ZodString;
    legIds: z.ZodArray<z.ZodString, "many">;
    netEntryPremiumUsd: z.ZodNumber;
    debitOrCredit: z.ZodEnum<["debit", "credit", "flat"]>;
    maxProfitUsd: z.ZodNullable<z.ZodNumber>;
    maxLossUsd: z.ZodNullable<z.ZodNumber>;
    breakEvenSpotsUsd: z.ZodArray<z.ZodNumber, "many">;
}, "strip", z.ZodTypeAny, {
    underlying: string;
    expiry: string;
    kind: "naked" | "call_spread" | "put_spread" | "straddle" | "strangle";
    maxProfitUsd: number | null;
    maxLossUsd: number | null;
    groupId: string;
    legIds: string[];
    netEntryPremiumUsd: number;
    debitOrCredit: "flat" | "debit" | "credit";
    breakEvenSpotsUsd: number[];
}, {
    underlying: string;
    expiry: string;
    kind: "naked" | "call_spread" | "put_spread" | "straddle" | "strangle";
    maxProfitUsd: number | null;
    maxLossUsd: number | null;
    groupId: string;
    legIds: string[];
    netEntryPremiumUsd: number;
    debitOrCredit: "flat" | "debit" | "credit";
    breakEvenSpotsUsd: number[];
}>;
export type StrategyGroup = z.infer<typeof StrategyGroupSchema>;
export declare const PortfolioMetricsSchema: z.ZodObject<{
    accountId: z.ZodString;
    generatedAt: z.ZodNumber;
    forwardDays: z.ZodNumber;
    totals: z.ZodObject<{
        netDeltaUsd: z.ZodNumber;
        netGammaUsd: z.ZodNumber;
        netVegaUsd: z.ZodNumber;
        netThetaUsd: z.ZodNumber;
        netVannaUsd: z.ZodNumber;
        netVolgaUsd: z.ZodNumber;
        unrealizedPnlUsd: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        netDeltaUsd: number;
        netGammaUsd: number;
        netVegaUsd: number;
        netThetaUsd: number;
        netVannaUsd: number;
        netVolgaUsd: number;
        unrealizedPnlUsd: number;
    }, {
        netDeltaUsd: number;
        netGammaUsd: number;
        netVegaUsd: number;
        netThetaUsd: number;
        netVannaUsd: number;
        netVolgaUsd: number;
        unrealizedPnlUsd: number;
    }>;
    pnlCurve: z.ZodObject<{
        status: z.ZodEnum<["ok", "empty", "mixed_underlyings", "missing_marks"]>;
        underlying: z.ZodNullable<z.ZodString>;
        currentSpotUsd: z.ZodNullable<z.ZodNumber>;
        breakEvenPricesUsd: z.ZodArray<z.ZodNumber, "many">;
        maxProfitUsd: z.ZodNullable<z.ZodNumber>;
        maxLossUsd: z.ZodNullable<z.ZodNumber>;
        upsideBounded: z.ZodBoolean;
        downsideBounded: z.ZodBoolean;
        points: z.ZodArray<z.ZodObject<{
            underlyingPriceUsd: z.ZodNumber;
            nowPnlUsd: z.ZodNumber;
            forwardPnlUsd: z.ZodNullable<z.ZodNumber>;
            expiryPnlUsd: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            underlyingPriceUsd: number;
            nowPnlUsd: number;
            forwardPnlUsd: number | null;
            expiryPnlUsd: number;
        }, {
            underlyingPriceUsd: number;
            nowPnlUsd: number;
            forwardPnlUsd: number | null;
            expiryPnlUsd: number;
        }>, "many">;
    }, "strip", z.ZodTypeAny, {
        underlying: string | null;
        status: "ok" | "empty" | "mixed_underlyings" | "missing_marks";
        currentSpotUsd: number | null;
        breakEvenPricesUsd: number[];
        maxProfitUsd: number | null;
        maxLossUsd: number | null;
        upsideBounded: boolean;
        downsideBounded: boolean;
        points: {
            underlyingPriceUsd: number;
            nowPnlUsd: number;
            forwardPnlUsd: number | null;
            expiryPnlUsd: number;
        }[];
    }, {
        underlying: string | null;
        status: "ok" | "empty" | "mixed_underlyings" | "missing_marks";
        currentSpotUsd: number | null;
        breakEvenPricesUsd: number[];
        maxProfitUsd: number | null;
        maxLossUsd: number | null;
        upsideBounded: boolean;
        downsideBounded: boolean;
        points: {
            underlyingPriceUsd: number;
            nowPnlUsd: number;
            forwardPnlUsd: number | null;
            expiryPnlUsd: number;
        }[];
    }>;
    byStrike: z.ZodArray<z.ZodObject<{
        strike: z.ZodNumber;
        expiry: z.ZodString;
        optionRight: z.ZodEnum<["call", "put"]>;
        delta: z.ZodNumber;
        vega: z.ZodNumber;
        gamma: z.ZodNumber;
        vanna: z.ZodNumber;
        volga: z.ZodNumber;
        contracts: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        expiry: string;
        strike: number;
        delta: number;
        gamma: number;
        vega: number;
        optionRight: "call" | "put";
        vanna: number;
        volga: number;
        contracts: number;
    }, {
        expiry: string;
        strike: number;
        delta: number;
        gamma: number;
        vega: number;
        optionRight: "call" | "put";
        vanna: number;
        volga: number;
        contracts: number;
    }>, "many">;
    byExpiry: z.ZodArray<z.ZodObject<{
        expiry: z.ZodString;
        dte: z.ZodNumber;
        vega: z.ZodNumber;
        gamma: z.ZodNumber;
        theta: z.ZodNumber;
        contracts: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        expiry: string;
        dte: number;
        gamma: number;
        theta: number;
        vega: number;
        contracts: number;
    }, {
        expiry: string;
        dte: number;
        gamma: number;
        theta: number;
        vega: number;
        contracts: number;
    }>, "many">;
    breakEven: z.ZodArray<z.ZodObject<{
        legId: z.ZodString;
        strike: z.ZodNumber;
        expiry: z.ZodString;
        optionRight: z.ZodEnum<["call", "put"]>;
        entryIv: z.ZodNullable<z.ZodNumber>;
        currentMarkUsd: z.ZodNullable<z.ZodNumber>;
        currentIv: z.ZodNullable<z.ZodNumber>;
        breakEvenIv: z.ZodNullable<z.ZodNumber>;
        ivCushionPct: z.ZodNullable<z.ZodNumber>;
        currentIvIsModel: z.ZodOptional<z.ZodBoolean>;
        beNote: z.ZodOptional<z.ZodEnum<["capped", "below_intrinsic", "above_upper"]>>;
    }, "strip", z.ZodTypeAny, {
        expiry: string;
        strike: number;
        legId: string;
        optionRight: "call" | "put";
        entryIv: number | null;
        currentMarkUsd: number | null;
        currentIv: number | null;
        breakEvenIv: number | null;
        ivCushionPct: number | null;
        currentIvIsModel?: boolean | undefined;
        beNote?: "capped" | "below_intrinsic" | "above_upper" | undefined;
    }, {
        expiry: string;
        strike: number;
        legId: string;
        optionRight: "call" | "put";
        entryIv: number | null;
        currentMarkUsd: number | null;
        currentIv: number | null;
        breakEvenIv: number | null;
        ivCushionPct: number | null;
        currentIvIsModel?: boolean | undefined;
        beNote?: "capped" | "below_intrinsic" | "above_upper" | undefined;
    }>, "many">;
    shockGrid: z.ZodArray<z.ZodArray<z.ZodObject<{
        atmShiftVolPts: z.ZodNumber;
        skewShiftPerLogK: z.ZodNumber;
        totalPnlUsd: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        totalPnlUsd: number;
        atmShiftVolPts: number;
        skewShiftPerLogK: number;
    }, {
        totalPnlUsd: number;
        atmShiftVolPts: number;
        skewShiftPerLogK: number;
    }>, "many">, "many">;
    strategies: z.ZodArray<z.ZodObject<{
        groupId: z.ZodString;
        kind: z.ZodEnum<["naked", "call_spread", "put_spread", "straddle", "strangle"]>;
        underlying: z.ZodString;
        expiry: z.ZodString;
        legIds: z.ZodArray<z.ZodString, "many">;
        netEntryPremiumUsd: z.ZodNumber;
        debitOrCredit: z.ZodEnum<["debit", "credit", "flat"]>;
        maxProfitUsd: z.ZodNullable<z.ZodNumber>;
        maxLossUsd: z.ZodNullable<z.ZodNumber>;
        breakEvenSpotsUsd: z.ZodArray<z.ZodNumber, "many">;
    }, "strip", z.ZodTypeAny, {
        underlying: string;
        expiry: string;
        kind: "naked" | "call_spread" | "put_spread" | "straddle" | "strangle";
        maxProfitUsd: number | null;
        maxLossUsd: number | null;
        groupId: string;
        legIds: string[];
        netEntryPremiumUsd: number;
        debitOrCredit: "flat" | "debit" | "credit";
        breakEvenSpotsUsd: number[];
    }, {
        underlying: string;
        expiry: string;
        kind: "naked" | "call_spread" | "put_spread" | "straddle" | "strangle";
        maxProfitUsd: number | null;
        maxLossUsd: number | null;
        groupId: string;
        legIds: string[];
        netEntryPremiumUsd: number;
        debitOrCredit: "flat" | "debit" | "credit";
        breakEvenSpotsUsd: number[];
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    generatedAt: number;
    accountId: string;
    forwardDays: number;
    totals: {
        netDeltaUsd: number;
        netGammaUsd: number;
        netVegaUsd: number;
        netThetaUsd: number;
        netVannaUsd: number;
        netVolgaUsd: number;
        unrealizedPnlUsd: number;
    };
    pnlCurve: {
        underlying: string | null;
        status: "ok" | "empty" | "mixed_underlyings" | "missing_marks";
        currentSpotUsd: number | null;
        breakEvenPricesUsd: number[];
        maxProfitUsd: number | null;
        maxLossUsd: number | null;
        upsideBounded: boolean;
        downsideBounded: boolean;
        points: {
            underlyingPriceUsd: number;
            nowPnlUsd: number;
            forwardPnlUsd: number | null;
            expiryPnlUsd: number;
        }[];
    };
    byStrike: {
        expiry: string;
        strike: number;
        delta: number;
        gamma: number;
        vega: number;
        optionRight: "call" | "put";
        vanna: number;
        volga: number;
        contracts: number;
    }[];
    byExpiry: {
        expiry: string;
        dte: number;
        gamma: number;
        theta: number;
        vega: number;
        contracts: number;
    }[];
    breakEven: {
        expiry: string;
        strike: number;
        legId: string;
        optionRight: "call" | "put";
        entryIv: number | null;
        currentMarkUsd: number | null;
        currentIv: number | null;
        breakEvenIv: number | null;
        ivCushionPct: number | null;
        currentIvIsModel?: boolean | undefined;
        beNote?: "capped" | "below_intrinsic" | "above_upper" | undefined;
    }[];
    shockGrid: {
        totalPnlUsd: number;
        atmShiftVolPts: number;
        skewShiftPerLogK: number;
    }[][];
    strategies: {
        underlying: string;
        expiry: string;
        kind: "naked" | "call_spread" | "put_spread" | "straddle" | "strangle";
        maxProfitUsd: number | null;
        maxLossUsd: number | null;
        groupId: string;
        legIds: string[];
        netEntryPremiumUsd: number;
        debitOrCredit: "flat" | "debit" | "credit";
        breakEvenSpotsUsd: number[];
    }[];
}, {
    generatedAt: number;
    accountId: string;
    forwardDays: number;
    totals: {
        netDeltaUsd: number;
        netGammaUsd: number;
        netVegaUsd: number;
        netThetaUsd: number;
        netVannaUsd: number;
        netVolgaUsd: number;
        unrealizedPnlUsd: number;
    };
    pnlCurve: {
        underlying: string | null;
        status: "ok" | "empty" | "mixed_underlyings" | "missing_marks";
        currentSpotUsd: number | null;
        breakEvenPricesUsd: number[];
        maxProfitUsd: number | null;
        maxLossUsd: number | null;
        upsideBounded: boolean;
        downsideBounded: boolean;
        points: {
            underlyingPriceUsd: number;
            nowPnlUsd: number;
            forwardPnlUsd: number | null;
            expiryPnlUsd: number;
        }[];
    };
    byStrike: {
        expiry: string;
        strike: number;
        delta: number;
        gamma: number;
        vega: number;
        optionRight: "call" | "put";
        vanna: number;
        volga: number;
        contracts: number;
    }[];
    byExpiry: {
        expiry: string;
        dte: number;
        gamma: number;
        theta: number;
        vega: number;
        contracts: number;
    }[];
    breakEven: {
        expiry: string;
        strike: number;
        legId: string;
        optionRight: "call" | "put";
        entryIv: number | null;
        currentMarkUsd: number | null;
        currentIv: number | null;
        breakEvenIv: number | null;
        ivCushionPct: number | null;
        currentIvIsModel?: boolean | undefined;
        beNote?: "capped" | "below_intrinsic" | "above_upper" | undefined;
    }[];
    shockGrid: {
        totalPnlUsd: number;
        atmShiftVolPts: number;
        skewShiftPerLogK: number;
    }[][];
    strategies: {
        underlying: string;
        expiry: string;
        kind: "naked" | "call_spread" | "put_spread" | "straddle" | "strangle";
        maxProfitUsd: number | null;
        maxLossUsd: number | null;
        groupId: string;
        legIds: string[];
        netEntryPremiumUsd: number;
        debitOrCredit: "flat" | "debit" | "credit";
        breakEvenSpotsUsd: number[];
    }[];
}>;
export type PortfolioMetrics = z.infer<typeof PortfolioMetricsSchema>;
export declare const PortfolioWsClientMessageSchema: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
    type: z.ZodLiteral<"subscribe">;
    subscriptionId: z.ZodString;
    forwardDays: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    type: "subscribe";
    subscriptionId: string;
    forwardDays?: number | undefined;
}, {
    type: "subscribe";
    subscriptionId: string;
    forwardDays?: number | undefined;
}>, z.ZodObject<{
    type: z.ZodLiteral<"unsubscribe">;
    subscriptionId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "unsubscribe";
    subscriptionId: string;
}, {
    type: "unsubscribe";
    subscriptionId: string;
}>]>;
export type PortfolioWsClientMessage = z.infer<typeof PortfolioWsClientMessageSchema>;
export declare const PortfolioWsServerMessageSchema: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
    type: z.ZodLiteral<"hello">;
    accountId: z.ZodString;
    serverTime: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    type: "hello";
    serverTime: number;
    accountId: string;
}, {
    type: "hello";
    serverTime: number;
    accountId: string;
}>, z.ZodObject<{
    type: z.ZodLiteral<"snapshot">;
    seq: z.ZodNumber;
    metrics: z.ZodObject<{
        accountId: z.ZodString;
        generatedAt: z.ZodNumber;
        forwardDays: z.ZodNumber;
        totals: z.ZodObject<{
            netDeltaUsd: z.ZodNumber;
            netGammaUsd: z.ZodNumber;
            netVegaUsd: z.ZodNumber;
            netThetaUsd: z.ZodNumber;
            netVannaUsd: z.ZodNumber;
            netVolgaUsd: z.ZodNumber;
            unrealizedPnlUsd: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            netDeltaUsd: number;
            netGammaUsd: number;
            netVegaUsd: number;
            netThetaUsd: number;
            netVannaUsd: number;
            netVolgaUsd: number;
            unrealizedPnlUsd: number;
        }, {
            netDeltaUsd: number;
            netGammaUsd: number;
            netVegaUsd: number;
            netThetaUsd: number;
            netVannaUsd: number;
            netVolgaUsd: number;
            unrealizedPnlUsd: number;
        }>;
        pnlCurve: z.ZodObject<{
            status: z.ZodEnum<["ok", "empty", "mixed_underlyings", "missing_marks"]>;
            underlying: z.ZodNullable<z.ZodString>;
            currentSpotUsd: z.ZodNullable<z.ZodNumber>;
            breakEvenPricesUsd: z.ZodArray<z.ZodNumber, "many">;
            maxProfitUsd: z.ZodNullable<z.ZodNumber>;
            maxLossUsd: z.ZodNullable<z.ZodNumber>;
            upsideBounded: z.ZodBoolean;
            downsideBounded: z.ZodBoolean;
            points: z.ZodArray<z.ZodObject<{
                underlyingPriceUsd: z.ZodNumber;
                nowPnlUsd: z.ZodNumber;
                forwardPnlUsd: z.ZodNullable<z.ZodNumber>;
                expiryPnlUsd: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                underlyingPriceUsd: number;
                nowPnlUsd: number;
                forwardPnlUsd: number | null;
                expiryPnlUsd: number;
            }, {
                underlyingPriceUsd: number;
                nowPnlUsd: number;
                forwardPnlUsd: number | null;
                expiryPnlUsd: number;
            }>, "many">;
        }, "strip", z.ZodTypeAny, {
            underlying: string | null;
            status: "ok" | "empty" | "mixed_underlyings" | "missing_marks";
            currentSpotUsd: number | null;
            breakEvenPricesUsd: number[];
            maxProfitUsd: number | null;
            maxLossUsd: number | null;
            upsideBounded: boolean;
            downsideBounded: boolean;
            points: {
                underlyingPriceUsd: number;
                nowPnlUsd: number;
                forwardPnlUsd: number | null;
                expiryPnlUsd: number;
            }[];
        }, {
            underlying: string | null;
            status: "ok" | "empty" | "mixed_underlyings" | "missing_marks";
            currentSpotUsd: number | null;
            breakEvenPricesUsd: number[];
            maxProfitUsd: number | null;
            maxLossUsd: number | null;
            upsideBounded: boolean;
            downsideBounded: boolean;
            points: {
                underlyingPriceUsd: number;
                nowPnlUsd: number;
                forwardPnlUsd: number | null;
                expiryPnlUsd: number;
            }[];
        }>;
        byStrike: z.ZodArray<z.ZodObject<{
            strike: z.ZodNumber;
            expiry: z.ZodString;
            optionRight: z.ZodEnum<["call", "put"]>;
            delta: z.ZodNumber;
            vega: z.ZodNumber;
            gamma: z.ZodNumber;
            vanna: z.ZodNumber;
            volga: z.ZodNumber;
            contracts: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            expiry: string;
            strike: number;
            delta: number;
            gamma: number;
            vega: number;
            optionRight: "call" | "put";
            vanna: number;
            volga: number;
            contracts: number;
        }, {
            expiry: string;
            strike: number;
            delta: number;
            gamma: number;
            vega: number;
            optionRight: "call" | "put";
            vanna: number;
            volga: number;
            contracts: number;
        }>, "many">;
        byExpiry: z.ZodArray<z.ZodObject<{
            expiry: z.ZodString;
            dte: z.ZodNumber;
            vega: z.ZodNumber;
            gamma: z.ZodNumber;
            theta: z.ZodNumber;
            contracts: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            expiry: string;
            dte: number;
            gamma: number;
            theta: number;
            vega: number;
            contracts: number;
        }, {
            expiry: string;
            dte: number;
            gamma: number;
            theta: number;
            vega: number;
            contracts: number;
        }>, "many">;
        breakEven: z.ZodArray<z.ZodObject<{
            legId: z.ZodString;
            strike: z.ZodNumber;
            expiry: z.ZodString;
            optionRight: z.ZodEnum<["call", "put"]>;
            entryIv: z.ZodNullable<z.ZodNumber>;
            currentMarkUsd: z.ZodNullable<z.ZodNumber>;
            currentIv: z.ZodNullable<z.ZodNumber>;
            breakEvenIv: z.ZodNullable<z.ZodNumber>;
            ivCushionPct: z.ZodNullable<z.ZodNumber>;
            currentIvIsModel: z.ZodOptional<z.ZodBoolean>;
            beNote: z.ZodOptional<z.ZodEnum<["capped", "below_intrinsic", "above_upper"]>>;
        }, "strip", z.ZodTypeAny, {
            expiry: string;
            strike: number;
            legId: string;
            optionRight: "call" | "put";
            entryIv: number | null;
            currentMarkUsd: number | null;
            currentIv: number | null;
            breakEvenIv: number | null;
            ivCushionPct: number | null;
            currentIvIsModel?: boolean | undefined;
            beNote?: "capped" | "below_intrinsic" | "above_upper" | undefined;
        }, {
            expiry: string;
            strike: number;
            legId: string;
            optionRight: "call" | "put";
            entryIv: number | null;
            currentMarkUsd: number | null;
            currentIv: number | null;
            breakEvenIv: number | null;
            ivCushionPct: number | null;
            currentIvIsModel?: boolean | undefined;
            beNote?: "capped" | "below_intrinsic" | "above_upper" | undefined;
        }>, "many">;
        shockGrid: z.ZodArray<z.ZodArray<z.ZodObject<{
            atmShiftVolPts: z.ZodNumber;
            skewShiftPerLogK: z.ZodNumber;
            totalPnlUsd: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            totalPnlUsd: number;
            atmShiftVolPts: number;
            skewShiftPerLogK: number;
        }, {
            totalPnlUsd: number;
            atmShiftVolPts: number;
            skewShiftPerLogK: number;
        }>, "many">, "many">;
        strategies: z.ZodArray<z.ZodObject<{
            groupId: z.ZodString;
            kind: z.ZodEnum<["naked", "call_spread", "put_spread", "straddle", "strangle"]>;
            underlying: z.ZodString;
            expiry: z.ZodString;
            legIds: z.ZodArray<z.ZodString, "many">;
            netEntryPremiumUsd: z.ZodNumber;
            debitOrCredit: z.ZodEnum<["debit", "credit", "flat"]>;
            maxProfitUsd: z.ZodNullable<z.ZodNumber>;
            maxLossUsd: z.ZodNullable<z.ZodNumber>;
            breakEvenSpotsUsd: z.ZodArray<z.ZodNumber, "many">;
        }, "strip", z.ZodTypeAny, {
            underlying: string;
            expiry: string;
            kind: "naked" | "call_spread" | "put_spread" | "straddle" | "strangle";
            maxProfitUsd: number | null;
            maxLossUsd: number | null;
            groupId: string;
            legIds: string[];
            netEntryPremiumUsd: number;
            debitOrCredit: "flat" | "debit" | "credit";
            breakEvenSpotsUsd: number[];
        }, {
            underlying: string;
            expiry: string;
            kind: "naked" | "call_spread" | "put_spread" | "straddle" | "strangle";
            maxProfitUsd: number | null;
            maxLossUsd: number | null;
            groupId: string;
            legIds: string[];
            netEntryPremiumUsd: number;
            debitOrCredit: "flat" | "debit" | "credit";
            breakEvenSpotsUsd: number[];
        }>, "many">;
    }, "strip", z.ZodTypeAny, {
        generatedAt: number;
        accountId: string;
        forwardDays: number;
        totals: {
            netDeltaUsd: number;
            netGammaUsd: number;
            netVegaUsd: number;
            netThetaUsd: number;
            netVannaUsd: number;
            netVolgaUsd: number;
            unrealizedPnlUsd: number;
        };
        pnlCurve: {
            underlying: string | null;
            status: "ok" | "empty" | "mixed_underlyings" | "missing_marks";
            currentSpotUsd: number | null;
            breakEvenPricesUsd: number[];
            maxProfitUsd: number | null;
            maxLossUsd: number | null;
            upsideBounded: boolean;
            downsideBounded: boolean;
            points: {
                underlyingPriceUsd: number;
                nowPnlUsd: number;
                forwardPnlUsd: number | null;
                expiryPnlUsd: number;
            }[];
        };
        byStrike: {
            expiry: string;
            strike: number;
            delta: number;
            gamma: number;
            vega: number;
            optionRight: "call" | "put";
            vanna: number;
            volga: number;
            contracts: number;
        }[];
        byExpiry: {
            expiry: string;
            dte: number;
            gamma: number;
            theta: number;
            vega: number;
            contracts: number;
        }[];
        breakEven: {
            expiry: string;
            strike: number;
            legId: string;
            optionRight: "call" | "put";
            entryIv: number | null;
            currentMarkUsd: number | null;
            currentIv: number | null;
            breakEvenIv: number | null;
            ivCushionPct: number | null;
            currentIvIsModel?: boolean | undefined;
            beNote?: "capped" | "below_intrinsic" | "above_upper" | undefined;
        }[];
        shockGrid: {
            totalPnlUsd: number;
            atmShiftVolPts: number;
            skewShiftPerLogK: number;
        }[][];
        strategies: {
            underlying: string;
            expiry: string;
            kind: "naked" | "call_spread" | "put_spread" | "straddle" | "strangle";
            maxProfitUsd: number | null;
            maxLossUsd: number | null;
            groupId: string;
            legIds: string[];
            netEntryPremiumUsd: number;
            debitOrCredit: "flat" | "debit" | "credit";
            breakEvenSpotsUsd: number[];
        }[];
    }, {
        generatedAt: number;
        accountId: string;
        forwardDays: number;
        totals: {
            netDeltaUsd: number;
            netGammaUsd: number;
            netVegaUsd: number;
            netThetaUsd: number;
            netVannaUsd: number;
            netVolgaUsd: number;
            unrealizedPnlUsd: number;
        };
        pnlCurve: {
            underlying: string | null;
            status: "ok" | "empty" | "mixed_underlyings" | "missing_marks";
            currentSpotUsd: number | null;
            breakEvenPricesUsd: number[];
            maxProfitUsd: number | null;
            maxLossUsd: number | null;
            upsideBounded: boolean;
            downsideBounded: boolean;
            points: {
                underlyingPriceUsd: number;
                nowPnlUsd: number;
                forwardPnlUsd: number | null;
                expiryPnlUsd: number;
            }[];
        };
        byStrike: {
            expiry: string;
            strike: number;
            delta: number;
            gamma: number;
            vega: number;
            optionRight: "call" | "put";
            vanna: number;
            volga: number;
            contracts: number;
        }[];
        byExpiry: {
            expiry: string;
            dte: number;
            gamma: number;
            theta: number;
            vega: number;
            contracts: number;
        }[];
        breakEven: {
            expiry: string;
            strike: number;
            legId: string;
            optionRight: "call" | "put";
            entryIv: number | null;
            currentMarkUsd: number | null;
            currentIv: number | null;
            breakEvenIv: number | null;
            ivCushionPct: number | null;
            currentIvIsModel?: boolean | undefined;
            beNote?: "capped" | "below_intrinsic" | "above_upper" | undefined;
        }[];
        shockGrid: {
            totalPnlUsd: number;
            atmShiftVolPts: number;
            skewShiftPerLogK: number;
        }[][];
        strategies: {
            underlying: string;
            expiry: string;
            kind: "naked" | "call_spread" | "put_spread" | "straddle" | "strangle";
            maxProfitUsd: number | null;
            maxLossUsd: number | null;
            groupId: string;
            legIds: string[];
            netEntryPremiumUsd: number;
            debitOrCredit: "flat" | "debit" | "credit";
            breakEvenSpotsUsd: number[];
        }[];
    }>;
    positions: z.ZodArray<z.ZodObject<{
        legId: z.ZodString;
        underlying: z.ZodString;
        expiry: z.ZodString;
        strike: z.ZodNumber;
        optionRight: z.ZodEnum<["call", "put"]>;
        size: z.ZodEffects<z.ZodNumber, number, number>;
        entryPriceUsd: z.ZodNumber;
        entryIv: z.ZodNullable<z.ZodNumber>;
        entryIvIsModel: z.ZodOptional<z.ZodBoolean>;
        realizedPnlUsd: z.ZodDefault<z.ZodNumber>;
        entryTs: z.ZodNumber;
        venueHint: z.ZodNullable<z.ZodEnum<["deribit", "okx", "bybit", "binance", "derive", "coincall", "thalex", "gateio", "paradex"]>>;
        source: z.ZodEnum<["manual", "paper", "deribit", "okx", "binance", "bybit", "derive", "coincall", "thalex", "gateio"]>;
    }, "strip", z.ZodTypeAny, {
        underlying: string;
        expiry: string;
        strike: number;
        source: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "gateio" | "manual" | "paper";
        legId: string;
        optionRight: "call" | "put";
        size: number;
        entryPriceUsd: number;
        entryIv: number | null;
        realizedPnlUsd: number;
        entryTs: number;
        venueHint: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "gateio" | "paradex" | null;
        entryIvIsModel?: boolean | undefined;
    }, {
        underlying: string;
        expiry: string;
        strike: number;
        source: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "gateio" | "manual" | "paper";
        legId: string;
        optionRight: "call" | "put";
        size: number;
        entryPriceUsd: number;
        entryIv: number | null;
        entryTs: number;
        venueHint: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "gateio" | "paradex" | null;
        entryIvIsModel?: boolean | undefined;
        realizedPnlUsd?: number | undefined;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    type: "snapshot";
    seq: number;
    metrics: {
        generatedAt: number;
        accountId: string;
        forwardDays: number;
        totals: {
            netDeltaUsd: number;
            netGammaUsd: number;
            netVegaUsd: number;
            netThetaUsd: number;
            netVannaUsd: number;
            netVolgaUsd: number;
            unrealizedPnlUsd: number;
        };
        pnlCurve: {
            underlying: string | null;
            status: "ok" | "empty" | "mixed_underlyings" | "missing_marks";
            currentSpotUsd: number | null;
            breakEvenPricesUsd: number[];
            maxProfitUsd: number | null;
            maxLossUsd: number | null;
            upsideBounded: boolean;
            downsideBounded: boolean;
            points: {
                underlyingPriceUsd: number;
                nowPnlUsd: number;
                forwardPnlUsd: number | null;
                expiryPnlUsd: number;
            }[];
        };
        byStrike: {
            expiry: string;
            strike: number;
            delta: number;
            gamma: number;
            vega: number;
            optionRight: "call" | "put";
            vanna: number;
            volga: number;
            contracts: number;
        }[];
        byExpiry: {
            expiry: string;
            dte: number;
            gamma: number;
            theta: number;
            vega: number;
            contracts: number;
        }[];
        breakEven: {
            expiry: string;
            strike: number;
            legId: string;
            optionRight: "call" | "put";
            entryIv: number | null;
            currentMarkUsd: number | null;
            currentIv: number | null;
            breakEvenIv: number | null;
            ivCushionPct: number | null;
            currentIvIsModel?: boolean | undefined;
            beNote?: "capped" | "below_intrinsic" | "above_upper" | undefined;
        }[];
        shockGrid: {
            totalPnlUsd: number;
            atmShiftVolPts: number;
            skewShiftPerLogK: number;
        }[][];
        strategies: {
            underlying: string;
            expiry: string;
            kind: "naked" | "call_spread" | "put_spread" | "straddle" | "strangle";
            maxProfitUsd: number | null;
            maxLossUsd: number | null;
            groupId: string;
            legIds: string[];
            netEntryPremiumUsd: number;
            debitOrCredit: "flat" | "debit" | "credit";
            breakEvenSpotsUsd: number[];
        }[];
    };
    positions: {
        underlying: string;
        expiry: string;
        strike: number;
        source: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "gateio" | "manual" | "paper";
        legId: string;
        optionRight: "call" | "put";
        size: number;
        entryPriceUsd: number;
        entryIv: number | null;
        realizedPnlUsd: number;
        entryTs: number;
        venueHint: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "gateio" | "paradex" | null;
        entryIvIsModel?: boolean | undefined;
    }[];
}, {
    type: "snapshot";
    seq: number;
    metrics: {
        generatedAt: number;
        accountId: string;
        forwardDays: number;
        totals: {
            netDeltaUsd: number;
            netGammaUsd: number;
            netVegaUsd: number;
            netThetaUsd: number;
            netVannaUsd: number;
            netVolgaUsd: number;
            unrealizedPnlUsd: number;
        };
        pnlCurve: {
            underlying: string | null;
            status: "ok" | "empty" | "mixed_underlyings" | "missing_marks";
            currentSpotUsd: number | null;
            breakEvenPricesUsd: number[];
            maxProfitUsd: number | null;
            maxLossUsd: number | null;
            upsideBounded: boolean;
            downsideBounded: boolean;
            points: {
                underlyingPriceUsd: number;
                nowPnlUsd: number;
                forwardPnlUsd: number | null;
                expiryPnlUsd: number;
            }[];
        };
        byStrike: {
            expiry: string;
            strike: number;
            delta: number;
            gamma: number;
            vega: number;
            optionRight: "call" | "put";
            vanna: number;
            volga: number;
            contracts: number;
        }[];
        byExpiry: {
            expiry: string;
            dte: number;
            gamma: number;
            theta: number;
            vega: number;
            contracts: number;
        }[];
        breakEven: {
            expiry: string;
            strike: number;
            legId: string;
            optionRight: "call" | "put";
            entryIv: number | null;
            currentMarkUsd: number | null;
            currentIv: number | null;
            breakEvenIv: number | null;
            ivCushionPct: number | null;
            currentIvIsModel?: boolean | undefined;
            beNote?: "capped" | "below_intrinsic" | "above_upper" | undefined;
        }[];
        shockGrid: {
            totalPnlUsd: number;
            atmShiftVolPts: number;
            skewShiftPerLogK: number;
        }[][];
        strategies: {
            underlying: string;
            expiry: string;
            kind: "naked" | "call_spread" | "put_spread" | "straddle" | "strangle";
            maxProfitUsd: number | null;
            maxLossUsd: number | null;
            groupId: string;
            legIds: string[];
            netEntryPremiumUsd: number;
            debitOrCredit: "flat" | "debit" | "credit";
            breakEvenSpotsUsd: number[];
        }[];
    };
    positions: {
        underlying: string;
        expiry: string;
        strike: number;
        source: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "gateio" | "manual" | "paper";
        legId: string;
        optionRight: "call" | "put";
        size: number;
        entryPriceUsd: number;
        entryIv: number | null;
        entryTs: number;
        venueHint: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "gateio" | "paradex" | null;
        entryIvIsModel?: boolean | undefined;
        realizedPnlUsd?: number | undefined;
    }[];
}>, z.ZodObject<{
    type: z.ZodLiteral<"delta">;
    seq: z.ZodNumber;
    metrics: z.ZodObject<{
        accountId: z.ZodString;
        generatedAt: z.ZodNumber;
        forwardDays: z.ZodNumber;
        totals: z.ZodObject<{
            netDeltaUsd: z.ZodNumber;
            netGammaUsd: z.ZodNumber;
            netVegaUsd: z.ZodNumber;
            netThetaUsd: z.ZodNumber;
            netVannaUsd: z.ZodNumber;
            netVolgaUsd: z.ZodNumber;
            unrealizedPnlUsd: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            netDeltaUsd: number;
            netGammaUsd: number;
            netVegaUsd: number;
            netThetaUsd: number;
            netVannaUsd: number;
            netVolgaUsd: number;
            unrealizedPnlUsd: number;
        }, {
            netDeltaUsd: number;
            netGammaUsd: number;
            netVegaUsd: number;
            netThetaUsd: number;
            netVannaUsd: number;
            netVolgaUsd: number;
            unrealizedPnlUsd: number;
        }>;
        pnlCurve: z.ZodObject<{
            status: z.ZodEnum<["ok", "empty", "mixed_underlyings", "missing_marks"]>;
            underlying: z.ZodNullable<z.ZodString>;
            currentSpotUsd: z.ZodNullable<z.ZodNumber>;
            breakEvenPricesUsd: z.ZodArray<z.ZodNumber, "many">;
            maxProfitUsd: z.ZodNullable<z.ZodNumber>;
            maxLossUsd: z.ZodNullable<z.ZodNumber>;
            upsideBounded: z.ZodBoolean;
            downsideBounded: z.ZodBoolean;
            points: z.ZodArray<z.ZodObject<{
                underlyingPriceUsd: z.ZodNumber;
                nowPnlUsd: z.ZodNumber;
                forwardPnlUsd: z.ZodNullable<z.ZodNumber>;
                expiryPnlUsd: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                underlyingPriceUsd: number;
                nowPnlUsd: number;
                forwardPnlUsd: number | null;
                expiryPnlUsd: number;
            }, {
                underlyingPriceUsd: number;
                nowPnlUsd: number;
                forwardPnlUsd: number | null;
                expiryPnlUsd: number;
            }>, "many">;
        }, "strip", z.ZodTypeAny, {
            underlying: string | null;
            status: "ok" | "empty" | "mixed_underlyings" | "missing_marks";
            currentSpotUsd: number | null;
            breakEvenPricesUsd: number[];
            maxProfitUsd: number | null;
            maxLossUsd: number | null;
            upsideBounded: boolean;
            downsideBounded: boolean;
            points: {
                underlyingPriceUsd: number;
                nowPnlUsd: number;
                forwardPnlUsd: number | null;
                expiryPnlUsd: number;
            }[];
        }, {
            underlying: string | null;
            status: "ok" | "empty" | "mixed_underlyings" | "missing_marks";
            currentSpotUsd: number | null;
            breakEvenPricesUsd: number[];
            maxProfitUsd: number | null;
            maxLossUsd: number | null;
            upsideBounded: boolean;
            downsideBounded: boolean;
            points: {
                underlyingPriceUsd: number;
                nowPnlUsd: number;
                forwardPnlUsd: number | null;
                expiryPnlUsd: number;
            }[];
        }>;
        byStrike: z.ZodArray<z.ZodObject<{
            strike: z.ZodNumber;
            expiry: z.ZodString;
            optionRight: z.ZodEnum<["call", "put"]>;
            delta: z.ZodNumber;
            vega: z.ZodNumber;
            gamma: z.ZodNumber;
            vanna: z.ZodNumber;
            volga: z.ZodNumber;
            contracts: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            expiry: string;
            strike: number;
            delta: number;
            gamma: number;
            vega: number;
            optionRight: "call" | "put";
            vanna: number;
            volga: number;
            contracts: number;
        }, {
            expiry: string;
            strike: number;
            delta: number;
            gamma: number;
            vega: number;
            optionRight: "call" | "put";
            vanna: number;
            volga: number;
            contracts: number;
        }>, "many">;
        byExpiry: z.ZodArray<z.ZodObject<{
            expiry: z.ZodString;
            dte: z.ZodNumber;
            vega: z.ZodNumber;
            gamma: z.ZodNumber;
            theta: z.ZodNumber;
            contracts: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            expiry: string;
            dte: number;
            gamma: number;
            theta: number;
            vega: number;
            contracts: number;
        }, {
            expiry: string;
            dte: number;
            gamma: number;
            theta: number;
            vega: number;
            contracts: number;
        }>, "many">;
        breakEven: z.ZodArray<z.ZodObject<{
            legId: z.ZodString;
            strike: z.ZodNumber;
            expiry: z.ZodString;
            optionRight: z.ZodEnum<["call", "put"]>;
            entryIv: z.ZodNullable<z.ZodNumber>;
            currentMarkUsd: z.ZodNullable<z.ZodNumber>;
            currentIv: z.ZodNullable<z.ZodNumber>;
            breakEvenIv: z.ZodNullable<z.ZodNumber>;
            ivCushionPct: z.ZodNullable<z.ZodNumber>;
            currentIvIsModel: z.ZodOptional<z.ZodBoolean>;
            beNote: z.ZodOptional<z.ZodEnum<["capped", "below_intrinsic", "above_upper"]>>;
        }, "strip", z.ZodTypeAny, {
            expiry: string;
            strike: number;
            legId: string;
            optionRight: "call" | "put";
            entryIv: number | null;
            currentMarkUsd: number | null;
            currentIv: number | null;
            breakEvenIv: number | null;
            ivCushionPct: number | null;
            currentIvIsModel?: boolean | undefined;
            beNote?: "capped" | "below_intrinsic" | "above_upper" | undefined;
        }, {
            expiry: string;
            strike: number;
            legId: string;
            optionRight: "call" | "put";
            entryIv: number | null;
            currentMarkUsd: number | null;
            currentIv: number | null;
            breakEvenIv: number | null;
            ivCushionPct: number | null;
            currentIvIsModel?: boolean | undefined;
            beNote?: "capped" | "below_intrinsic" | "above_upper" | undefined;
        }>, "many">;
        shockGrid: z.ZodArray<z.ZodArray<z.ZodObject<{
            atmShiftVolPts: z.ZodNumber;
            skewShiftPerLogK: z.ZodNumber;
            totalPnlUsd: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            totalPnlUsd: number;
            atmShiftVolPts: number;
            skewShiftPerLogK: number;
        }, {
            totalPnlUsd: number;
            atmShiftVolPts: number;
            skewShiftPerLogK: number;
        }>, "many">, "many">;
        strategies: z.ZodArray<z.ZodObject<{
            groupId: z.ZodString;
            kind: z.ZodEnum<["naked", "call_spread", "put_spread", "straddle", "strangle"]>;
            underlying: z.ZodString;
            expiry: z.ZodString;
            legIds: z.ZodArray<z.ZodString, "many">;
            netEntryPremiumUsd: z.ZodNumber;
            debitOrCredit: z.ZodEnum<["debit", "credit", "flat"]>;
            maxProfitUsd: z.ZodNullable<z.ZodNumber>;
            maxLossUsd: z.ZodNullable<z.ZodNumber>;
            breakEvenSpotsUsd: z.ZodArray<z.ZodNumber, "many">;
        }, "strip", z.ZodTypeAny, {
            underlying: string;
            expiry: string;
            kind: "naked" | "call_spread" | "put_spread" | "straddle" | "strangle";
            maxProfitUsd: number | null;
            maxLossUsd: number | null;
            groupId: string;
            legIds: string[];
            netEntryPremiumUsd: number;
            debitOrCredit: "flat" | "debit" | "credit";
            breakEvenSpotsUsd: number[];
        }, {
            underlying: string;
            expiry: string;
            kind: "naked" | "call_spread" | "put_spread" | "straddle" | "strangle";
            maxProfitUsd: number | null;
            maxLossUsd: number | null;
            groupId: string;
            legIds: string[];
            netEntryPremiumUsd: number;
            debitOrCredit: "flat" | "debit" | "credit";
            breakEvenSpotsUsd: number[];
        }>, "many">;
    }, "strip", z.ZodTypeAny, {
        generatedAt: number;
        accountId: string;
        forwardDays: number;
        totals: {
            netDeltaUsd: number;
            netGammaUsd: number;
            netVegaUsd: number;
            netThetaUsd: number;
            netVannaUsd: number;
            netVolgaUsd: number;
            unrealizedPnlUsd: number;
        };
        pnlCurve: {
            underlying: string | null;
            status: "ok" | "empty" | "mixed_underlyings" | "missing_marks";
            currentSpotUsd: number | null;
            breakEvenPricesUsd: number[];
            maxProfitUsd: number | null;
            maxLossUsd: number | null;
            upsideBounded: boolean;
            downsideBounded: boolean;
            points: {
                underlyingPriceUsd: number;
                nowPnlUsd: number;
                forwardPnlUsd: number | null;
                expiryPnlUsd: number;
            }[];
        };
        byStrike: {
            expiry: string;
            strike: number;
            delta: number;
            gamma: number;
            vega: number;
            optionRight: "call" | "put";
            vanna: number;
            volga: number;
            contracts: number;
        }[];
        byExpiry: {
            expiry: string;
            dte: number;
            gamma: number;
            theta: number;
            vega: number;
            contracts: number;
        }[];
        breakEven: {
            expiry: string;
            strike: number;
            legId: string;
            optionRight: "call" | "put";
            entryIv: number | null;
            currentMarkUsd: number | null;
            currentIv: number | null;
            breakEvenIv: number | null;
            ivCushionPct: number | null;
            currentIvIsModel?: boolean | undefined;
            beNote?: "capped" | "below_intrinsic" | "above_upper" | undefined;
        }[];
        shockGrid: {
            totalPnlUsd: number;
            atmShiftVolPts: number;
            skewShiftPerLogK: number;
        }[][];
        strategies: {
            underlying: string;
            expiry: string;
            kind: "naked" | "call_spread" | "put_spread" | "straddle" | "strangle";
            maxProfitUsd: number | null;
            maxLossUsd: number | null;
            groupId: string;
            legIds: string[];
            netEntryPremiumUsd: number;
            debitOrCredit: "flat" | "debit" | "credit";
            breakEvenSpotsUsd: number[];
        }[];
    }, {
        generatedAt: number;
        accountId: string;
        forwardDays: number;
        totals: {
            netDeltaUsd: number;
            netGammaUsd: number;
            netVegaUsd: number;
            netThetaUsd: number;
            netVannaUsd: number;
            netVolgaUsd: number;
            unrealizedPnlUsd: number;
        };
        pnlCurve: {
            underlying: string | null;
            status: "ok" | "empty" | "mixed_underlyings" | "missing_marks";
            currentSpotUsd: number | null;
            breakEvenPricesUsd: number[];
            maxProfitUsd: number | null;
            maxLossUsd: number | null;
            upsideBounded: boolean;
            downsideBounded: boolean;
            points: {
                underlyingPriceUsd: number;
                nowPnlUsd: number;
                forwardPnlUsd: number | null;
                expiryPnlUsd: number;
            }[];
        };
        byStrike: {
            expiry: string;
            strike: number;
            delta: number;
            gamma: number;
            vega: number;
            optionRight: "call" | "put";
            vanna: number;
            volga: number;
            contracts: number;
        }[];
        byExpiry: {
            expiry: string;
            dte: number;
            gamma: number;
            theta: number;
            vega: number;
            contracts: number;
        }[];
        breakEven: {
            expiry: string;
            strike: number;
            legId: string;
            optionRight: "call" | "put";
            entryIv: number | null;
            currentMarkUsd: number | null;
            currentIv: number | null;
            breakEvenIv: number | null;
            ivCushionPct: number | null;
            currentIvIsModel?: boolean | undefined;
            beNote?: "capped" | "below_intrinsic" | "above_upper" | undefined;
        }[];
        shockGrid: {
            totalPnlUsd: number;
            atmShiftVolPts: number;
            skewShiftPerLogK: number;
        }[][];
        strategies: {
            underlying: string;
            expiry: string;
            kind: "naked" | "call_spread" | "put_spread" | "straddle" | "strangle";
            maxProfitUsd: number | null;
            maxLossUsd: number | null;
            groupId: string;
            legIds: string[];
            netEntryPremiumUsd: number;
            debitOrCredit: "flat" | "debit" | "credit";
            breakEvenSpotsUsd: number[];
        }[];
    }>;
    changedLegIds: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    type: "delta";
    seq: number;
    metrics: {
        generatedAt: number;
        accountId: string;
        forwardDays: number;
        totals: {
            netDeltaUsd: number;
            netGammaUsd: number;
            netVegaUsd: number;
            netThetaUsd: number;
            netVannaUsd: number;
            netVolgaUsd: number;
            unrealizedPnlUsd: number;
        };
        pnlCurve: {
            underlying: string | null;
            status: "ok" | "empty" | "mixed_underlyings" | "missing_marks";
            currentSpotUsd: number | null;
            breakEvenPricesUsd: number[];
            maxProfitUsd: number | null;
            maxLossUsd: number | null;
            upsideBounded: boolean;
            downsideBounded: boolean;
            points: {
                underlyingPriceUsd: number;
                nowPnlUsd: number;
                forwardPnlUsd: number | null;
                expiryPnlUsd: number;
            }[];
        };
        byStrike: {
            expiry: string;
            strike: number;
            delta: number;
            gamma: number;
            vega: number;
            optionRight: "call" | "put";
            vanna: number;
            volga: number;
            contracts: number;
        }[];
        byExpiry: {
            expiry: string;
            dte: number;
            gamma: number;
            theta: number;
            vega: number;
            contracts: number;
        }[];
        breakEven: {
            expiry: string;
            strike: number;
            legId: string;
            optionRight: "call" | "put";
            entryIv: number | null;
            currentMarkUsd: number | null;
            currentIv: number | null;
            breakEvenIv: number | null;
            ivCushionPct: number | null;
            currentIvIsModel?: boolean | undefined;
            beNote?: "capped" | "below_intrinsic" | "above_upper" | undefined;
        }[];
        shockGrid: {
            totalPnlUsd: number;
            atmShiftVolPts: number;
            skewShiftPerLogK: number;
        }[][];
        strategies: {
            underlying: string;
            expiry: string;
            kind: "naked" | "call_spread" | "put_spread" | "straddle" | "strangle";
            maxProfitUsd: number | null;
            maxLossUsd: number | null;
            groupId: string;
            legIds: string[];
            netEntryPremiumUsd: number;
            debitOrCredit: "flat" | "debit" | "credit";
            breakEvenSpotsUsd: number[];
        }[];
    };
    changedLegIds: string[];
}, {
    type: "delta";
    seq: number;
    metrics: {
        generatedAt: number;
        accountId: string;
        forwardDays: number;
        totals: {
            netDeltaUsd: number;
            netGammaUsd: number;
            netVegaUsd: number;
            netThetaUsd: number;
            netVannaUsd: number;
            netVolgaUsd: number;
            unrealizedPnlUsd: number;
        };
        pnlCurve: {
            underlying: string | null;
            status: "ok" | "empty" | "mixed_underlyings" | "missing_marks";
            currentSpotUsd: number | null;
            breakEvenPricesUsd: number[];
            maxProfitUsd: number | null;
            maxLossUsd: number | null;
            upsideBounded: boolean;
            downsideBounded: boolean;
            points: {
                underlyingPriceUsd: number;
                nowPnlUsd: number;
                forwardPnlUsd: number | null;
                expiryPnlUsd: number;
            }[];
        };
        byStrike: {
            expiry: string;
            strike: number;
            delta: number;
            gamma: number;
            vega: number;
            optionRight: "call" | "put";
            vanna: number;
            volga: number;
            contracts: number;
        }[];
        byExpiry: {
            expiry: string;
            dte: number;
            gamma: number;
            theta: number;
            vega: number;
            contracts: number;
        }[];
        breakEven: {
            expiry: string;
            strike: number;
            legId: string;
            optionRight: "call" | "put";
            entryIv: number | null;
            currentMarkUsd: number | null;
            currentIv: number | null;
            breakEvenIv: number | null;
            ivCushionPct: number | null;
            currentIvIsModel?: boolean | undefined;
            beNote?: "capped" | "below_intrinsic" | "above_upper" | undefined;
        }[];
        shockGrid: {
            totalPnlUsd: number;
            atmShiftVolPts: number;
            skewShiftPerLogK: number;
        }[][];
        strategies: {
            underlying: string;
            expiry: string;
            kind: "naked" | "call_spread" | "put_spread" | "straddle" | "strangle";
            maxProfitUsd: number | null;
            maxLossUsd: number | null;
            groupId: string;
            legIds: string[];
            netEntryPremiumUsd: number;
            debitOrCredit: "flat" | "debit" | "credit";
            breakEvenSpotsUsd: number[];
        }[];
    };
    changedLegIds: string[];
}>, z.ZodObject<{
    type: z.ZodLiteral<"error">;
    code: z.ZodString;
    message: z.ZodString;
}, "strip", z.ZodTypeAny, {
    code: string;
    message: string;
    type: "error";
}, {
    code: string;
    message: string;
    type: "error";
}>]>;
export type PortfolioWsServerMessage = z.infer<typeof PortfolioWsServerMessageSchema>;
//# sourceMappingURL=portfolio.d.ts.map