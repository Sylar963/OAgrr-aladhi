import { z } from 'zod';

// `book.{instrument}.none.{depth}.{interval}` sends whole top-N snapshots, so no change_id
// sequencing is needed. Levels are `[price, amount]` with price in the base currency.
const LevelSchema = z.tuple([z.number(), z.number()]);

export const DeribitBookSnapshotSchema = z.object({
  instrument_name: z.string(),
  timestamp: z.number(),
  bids: z.array(LevelSchema),
  asks: z.array(LevelSchema),
});

export const DeribitHeatmapTickerSchema = z.object({
  instrument_name: z.string(),
  /** The option's forward (Deribit's synthetic or the matching future). */
  underlying_price: z.number(),
});

export const DeribitHeatmapTradeSchema = z.object({
  instrument_name: z.string(),
  direction: z.enum(['buy', 'sell']),
  price: z.number(),
  amount: z.number(),
  /** Percentage (53.4 = 53.4%). */
  iv: z.number().optional(),
  timestamp: z.number(),
});

export const DeribitHeatmapTradesSchema = z.array(DeribitHeatmapTradeSchema);

export const DeribitDvolPushSchema = z.object({
  index_name: z.string(),
  /** Percentage. */
  volatility: z.number(),
});

export const DeribitHeatmapInstrumentSchema = z.object({
  instrument_name: z.string(),
  strike: z.number(),
  option_type: z.enum(['call', 'put']),
  expiration_timestamp: z.number(),
});

export const DeribitHeatmapInstrumentsSchema = z.array(DeribitHeatmapInstrumentSchema);

export const DeribitIndexPriceSchema = z.object({ index_price: z.number() });

export const DeribitVolatilityIndexDataSchema = z.object({
  data: z.array(z.tuple([z.number(), z.number(), z.number(), z.number(), z.number()])),
});

export type DeribitBookSnapshot = z.infer<typeof DeribitBookSnapshotSchema>;
export type DeribitHeatmapTrade = z.infer<typeof DeribitHeatmapTradeSchema>;
