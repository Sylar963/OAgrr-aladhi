import { z } from 'zod';

// optionMarkPrice bulk WS item
export const BinanceMarkPriceSchema = z.object({
  e: z.literal('markPrice'),
  s: z.string(),             // symbol
  mp: z.string(),            // markPrice
  i: z.string().optional(),  // indexPrice
  bo: z.string().optional(), // bestBid
  ao: z.string().optional(), // bestAsk
  bq: z.string().optional(), // bidQty
  aq: z.string().optional(), // askQty
  vo: z.string().optional(), // markIV
  b: z.string().optional(),  // bidIV
  a: z.string().optional(),  // askIV
  d: z.string().optional(),  // delta
  g: z.string().optional(),  // gamma
  t: z.string().optional(),  // theta
  v: z.string().optional(),  // vega
  E: z.number().optional(),  // eventTime
});
export type BinanceMarkPrice = z.infer<typeof BinanceMarkPriceSchema>;

// Combined stream wrapper
export const BinanceCombinedStreamSchema = z.object({
  stream: z.string(),
  data: z.array(z.unknown()),
});
export type BinanceCombinedStream = z.infer<typeof BinanceCombinedStreamSchema>;

export const BinancePriceFilterSchema = z.object({
  filterType: z.string(),
  tickSize: z.string().optional(),
  minPrice: z.string().optional(),
  maxPrice: z.string().optional(),
});
export type BinancePriceFilter = z.infer<typeof BinancePriceFilterSchema>;

export const BinanceInstrumentSchema = z.object({
  symbol: z.string(),
  quoteAsset: z.string().optional(),
  unit: z.number().optional(),
  minQty: z.string().optional(),
  filters: z.array(BinancePriceFilterSchema).optional(),
});
export type BinanceInstrument = z.infer<typeof BinanceInstrumentSchema>;
