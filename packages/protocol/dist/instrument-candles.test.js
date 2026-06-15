import { describe, it, expect } from 'vitest';
import { InstrumentCandleSchema, InstrumentCandlesResponseSchema, InstrumentCandlesQuerySchema, } from './instrument-candles.js';
const validCandle = {
    ts: 1_700_000_000_000,
    o: 1,
    h: 2,
    l: 0.5,
    c: 1.5,
    vol: 10,
    synthetic: false,
};
describe('InstrumentCandleSchema', () => {
    it('round-trips a valid candle unchanged', () => {
        const result = InstrumentCandleSchema.safeParse(validCandle);
        expect(result.success).toBe(true);
        if (result.success)
            expect(result.data).toEqual(validCandle);
    });
    it('rejects a negative OHLC value', () => {
        expect(InstrumentCandleSchema.safeParse({ ...validCandle, o: -1 }).success).toBe(false);
    });
    it('rejects a non-integer timestamp', () => {
        expect(InstrumentCandleSchema.safeParse({ ...validCandle, ts: 1.5 }).success).toBe(false);
    });
    it('rejects a candle missing the synthetic flag', () => {
        const { synthetic: _omit, ...rest } = validCandle;
        expect(InstrumentCandleSchema.safeParse(rest).success).toBe(false);
    });
});
describe('InstrumentCandlesResponseSchema', () => {
    const validResponse = {
        venue: 'deribit',
        symbol: 'BTC-27MAR26-70000-C',
        interval: '1h',
        candles: [validCandle],
        markLine: [{ ts: validCandle.ts, c: 1.5 }],
        priceCurrency: 'USD',
    };
    it('accepts a valid response', () => {
        expect(InstrumentCandlesResponseSchema.safeParse(validResponse).success).toBe(true);
    });
    it('rejects an unknown venue', () => {
        expect(InstrumentCandlesResponseSchema.safeParse({ ...validResponse, venue: 'kraken' }).success).toBe(false);
    });
    it('rejects an empty or over-long priceCurrency', () => {
        expect(InstrumentCandlesResponseSchema.safeParse({ ...validResponse, priceCurrency: '' }).success).toBe(false);
        expect(InstrumentCandlesResponseSchema.safeParse({ ...validResponse, priceCurrency: 'TOOLONGCUR' })
            .success).toBe(false);
    });
});
describe('InstrumentCandlesQuerySchema', () => {
    const validQuery = { venue: 'gateio', symbol: 'BTC_USDT-20260327-70000-C', interval: '1d', range: '30d' };
    it('round-trips a valid query unchanged', () => {
        const result = InstrumentCandlesQuerySchema.safeParse(validQuery);
        expect(result.success).toBe(true);
        if (result.success)
            expect(result.data).toEqual(validQuery);
    });
    it('rejects an unsupported interval', () => {
        expect(InstrumentCandlesQuerySchema.safeParse({ ...validQuery, interval: '3m' }).success).toBe(false);
    });
    it('rejects an unsupported range', () => {
        expect(InstrumentCandlesQuerySchema.safeParse({ ...validQuery, range: '90d' }).success).toBe(false);
    });
    it('rejects an empty symbol', () => {
        expect(InstrumentCandlesQuerySchema.safeParse({ ...validQuery, symbol: '' }).success).toBe(false);
    });
});
//# sourceMappingURL=instrument-candles.test.js.map