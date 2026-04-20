import { z } from 'zod';

export const CoincallInstrumentSchema = z.object({
  symbol: z.string(),
  baseCurrency: z.string(),
  expirationTimestamp: z.number(),
  strike: z.number(),
  symbolName: z.string(),
  isActive: z.boolean(),
  minQty: z.number(),
  tickSize: z.number(),
});
export type CoincallInstrument = z.infer<typeof CoincallInstrumentSchema>;

export const CoincallMarkPriceSchema = z.object({
  symbol: z.string(),
  markPrice: z.string(),
  indexPrice: z.string(),
  bidPrice: z.string().optional(),
  askPrice: z.string().optional(),
  bidSize: z.string().optional(),
  askSize: z.string().optional(),
  bidIv: z.string().optional(),
  askIv: z.string().optional(),
  delta: z.string().optional(),
  gamma: z.string().optional(),
  theta: z.string().optional(),
  vega: z.string().optional(),
  rho: z.string().optional(),
  time: z.number().optional(),
});
export type CoincallMarkPrice = z.infer<typeof CoincallMarkPriceSchema>;

export const CoincallOptionChainSchema = z.object({
  strike: z.number(),
  callOption: z
    .object({
      symbol: z.string(),
      bidPrice: z.string(),
      askPrice: z.string(),
      bidSize: z.string(),
      askSize: z.string(),
      markPrice: z.string(),
      indexPrice: z.string(),
      bidIv: z.string().optional(),
      askIv: z.string().optional(),
      delta: z.string().optional(),
      gamma: z.string().optional(),
      theta: z.string().optional(),
      vega: z.string().optional(),
    })
    .optional(),
  putOption: z
    .object({
      symbol: z.string(),
      bidPrice: z.string(),
      askPrice: z.string(),
      bidSize: z.string(),
      askSize: z.string(),
      markPrice: z.string(),
      indexPrice: z.string(),
      bidIv: z.string().optional(),
      askIv: z.string().optional(),
      delta: z.string().optional(),
      gamma: z.string().optional(),
      theta: z.string().optional(),
      vega: z.string().optional(),
    })
    .optional(),
});
export type CoincallOptionChain = z.infer<typeof CoincallOptionChainSchema>;

export const CoincallIndexPriceSchema = z.object({
  symbol: z.string(),
  indexPrice: z.string(),
  time: z.number(),
});
export type CoincallIndexPrice = z.infer<typeof CoincallIndexPriceSchema>;

export const CoincallTickerSchema = z.object({
  symbol: z.string(),
  lastPrice: z.string().optional(),
  volume24h: z.string().optional(),
  turnover24h: z.string().optional(),
  markPrice: z.string().optional(),
  indexPrice: z.string().optional(),
});
export type CoincallTicker = z.infer<typeof CoincallTickerSchema>;

export const CoincallPublicConfigSchema = z.object({
  optionConfig: z.record(z.string(), z.object({
    symbol: z.string(),
    takerFee: z.number(),
    maxOrderNumber: z.number(),
    multiplier: z.number(),
    settle: z.string(),
    priceDecimal: z.number(),
    limitMaxQty: z.number(),
    tickDecimal: z.number(),
    tickSize: z.number(),
    greeksDecimal: z.number(),
    makerFee: z.number(),
    marketMaxQty: z.number(),
    qtyDecimal: z.number(),
    maxPositionQty: z.number(),
    base: z.string(),
  })),
});
export type CoincallPublicConfig = z.infer<typeof CoincallPublicConfigSchema>;

export const CoincallTimeSchema = z.object({
  serverTime: z.number(),
});
export type CoincallTime = z.infer<typeof CoincallTimeSchema>;

export const CoincallWsMessageSchema = z.object({
  type: z.string(),
  channel: z.string().optional(),
  data: z.unknown().optional(),
});
export type CoincallWsMessage = z.infer<typeof CoincallWsMessageSchema>;

export const CoincallWsResponseSchema = z.object({
  type: z.string(),
  code: z.number().optional(),
  msg: z.string().optional(),
  channel: z.string().optional(),
  data: z.unknown().optional(),
  result: z.unknown().optional(),
  id: z.number().optional(),
});
export type CoincallWsResponse = z.infer<typeof CoincallWsResponseSchema>;
