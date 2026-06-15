import { z } from 'zod';
export declare const InstrumentCandleIntervalSchema: z.ZodEnum<["1m", "5m", "15m", "1h", "4h", "1d"]>;
export type InstrumentCandleInterval = z.infer<typeof InstrumentCandleIntervalSchema>;
export declare const InstrumentCandleRangeSchema: z.ZodEnum<["1d", "7d", "30d", "max"]>;
export type InstrumentCandleRange = z.infer<typeof InstrumentCandleRangeSchema>;
export declare const InstrumentCandleSchema: z.ZodObject<{
    ts: z.ZodNumber;
    o: z.ZodNumber;
    h: z.ZodNumber;
    l: z.ZodNumber;
    c: z.ZodNumber;
    vol: z.ZodNumber;
    synthetic: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    ts: number;
    o: number;
    h: number;
    l: number;
    c: number;
    vol: number;
    synthetic: boolean;
}, {
    ts: number;
    o: number;
    h: number;
    l: number;
    c: number;
    vol: number;
    synthetic: boolean;
}>;
export type InstrumentCandle = z.infer<typeof InstrumentCandleSchema>;
export declare const InstrumentMarkPointSchema: z.ZodObject<{
    ts: z.ZodNumber;
    c: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    ts: number;
    c: number;
}, {
    ts: number;
    c: number;
}>;
export type InstrumentMarkPoint = z.infer<typeof InstrumentMarkPointSchema>;
export declare const InstrumentCandlesResponseSchema: z.ZodObject<{
    venue: z.ZodEnum<["deribit", "okx", "bybit", "binance", "derive", "coincall", "thalex", "gateio", "paradex"]>;
    symbol: z.ZodString;
    interval: z.ZodEnum<["1m", "5m", "15m", "1h", "4h", "1d"]>;
    candles: z.ZodArray<z.ZodObject<{
        ts: z.ZodNumber;
        o: z.ZodNumber;
        h: z.ZodNumber;
        l: z.ZodNumber;
        c: z.ZodNumber;
        vol: z.ZodNumber;
        synthetic: z.ZodBoolean;
    }, "strip", z.ZodTypeAny, {
        ts: number;
        o: number;
        h: number;
        l: number;
        c: number;
        vol: number;
        synthetic: boolean;
    }, {
        ts: number;
        o: number;
        h: number;
        l: number;
        c: number;
        vol: number;
        synthetic: boolean;
    }>, "many">;
    markLine: z.ZodArray<z.ZodObject<{
        ts: z.ZodNumber;
        c: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        ts: number;
        c: number;
    }, {
        ts: number;
        c: number;
    }>, "many">;
    priceCurrency: z.ZodString;
}, "strip", z.ZodTypeAny, {
    symbol: string;
    venue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "gateio" | "paradex";
    interval: "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
    candles: {
        ts: number;
        o: number;
        h: number;
        l: number;
        c: number;
        vol: number;
        synthetic: boolean;
    }[];
    markLine: {
        ts: number;
        c: number;
    }[];
    priceCurrency: string;
}, {
    symbol: string;
    venue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "gateio" | "paradex";
    interval: "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
    candles: {
        ts: number;
        o: number;
        h: number;
        l: number;
        c: number;
        vol: number;
        synthetic: boolean;
    }[];
    markLine: {
        ts: number;
        c: number;
    }[];
    priceCurrency: string;
}>;
export type InstrumentCandlesResponse = z.infer<typeof InstrumentCandlesResponseSchema>;
export declare const InstrumentCandlesQuerySchema: z.ZodObject<{
    venue: z.ZodEnum<["deribit", "okx", "bybit", "binance", "derive", "coincall", "thalex", "gateio", "paradex"]>;
    symbol: z.ZodString;
    interval: z.ZodEnum<["1m", "5m", "15m", "1h", "4h", "1d"]>;
    range: z.ZodEnum<["1d", "7d", "30d", "max"]>;
}, "strip", z.ZodTypeAny, {
    symbol: string;
    venue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "gateio" | "paradex";
    interval: "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
    range: "max" | "1d" | "7d" | "30d";
}, {
    symbol: string;
    venue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "gateio" | "paradex";
    interval: "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
    range: "max" | "1d" | "7d" | "30d";
}>;
export type InstrumentCandlesQuery = z.infer<typeof InstrumentCandlesQuerySchema>;
//# sourceMappingURL=instrument-candles.d.ts.map