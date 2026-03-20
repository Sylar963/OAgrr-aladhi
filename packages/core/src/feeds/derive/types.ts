import { z } from 'zod';

// Derive sends ALL numeric values as strings (except stats.n).
// We keep them as strings in the schema and coerce in the normalizer.
const numStr = z.string().nullable().optional();

// Derive abbreviated ticker format — values are STRINGS, not numbers.
// Verified against live WS + REST data 2026-03-20.
export const DeriveTickerSchema = z.object({
  B: numStr,                    // best_bid_price
  best_bid_price: numStr,
  b: numStr,                    // best_bid_amount
  best_bid_amount: numStr,
  A: numStr,                    // best_ask_price
  best_ask_price: numStr,
  a: numStr,                    // best_ask_amount
  best_ask_amount: numStr,
  M: numStr,                    // mark_price
  mark_price: numStr,
  I: numStr,                    // index_price
  index_price: numStr,
  f: numStr,                    // funding_rate (null for options)
  t: z.number().optional(),     // timestamp (this one IS a number — unix ms)
  timestamp: z.number().optional(),
  option_pricing: z.object({
    d: numStr,                  // delta
    delta: numStr,
    g: numStr,                  // gamma
    gamma: numStr,
    t: numStr,                  // theta
    theta: numStr,
    v: numStr,                  // vega
    vega: numStr,
    r: numStr,                  // rho
    rho: numStr,
    i: numStr,                  // iv
    iv: numStr,
    m: numStr,                  // mark price (option)
    mark: numStr,
    f: numStr,                  // forward_price
    df: numStr,                 // discount_factor
    bi: numStr,                 // bid_iv
    bid_iv: numStr,
    ai: numStr,                 // ask_iv
    ask_iv: numStr,
  }).nullable().optional(),
  stats: z.object({
    oi: numStr,                 // open_interest
    v: numStr,                  // volume
    c: numStr,                  // 24h change
    pr: numStr,                 // price
    n: z.number().optional(),   // trade count (only non-string field)
    h: numStr,                  // high
    l: numStr,                  // low
    p: numStr,                  // avg price
  }).nullable().optional(),
  minp: numStr,                 // min order price
  maxp: numStr,                 // max order price
  instrument_ticker: z.unknown().optional(), // WS notification wrapper
}).passthrough();
export type DeriveTicker = z.infer<typeof DeriveTickerSchema>;

// public/get_instruments response item
// Docs: result is a direct array of these objects
export const DeriveInstrumentSchema = z.object({
  instrument_name: z.string(),
  instrument_type: z.string(),
  is_active: z.boolean().optional(),
  quote_currency: z.string().optional(),
  option_details: z.object({
    expiry: z.number(),            // Unix seconds (NOT ms)
    index: z.string(),             // e.g. "BTC-USD"
    option_type: z.string(),       // "C" or "P"
    strike: z.string(),            // Strike as string
    settlement_price: z.string().nullable().optional(),
  }).optional(),
  tick_size: z.string().optional(),
  minimum_amount: z.string().optional(),
  maximum_amount: z.string().optional(),
  amount_step: z.string().optional(),
  maker_fee_rate: z.string().optional(),
  taker_fee_rate: z.string().optional(),
}).passthrough();
export type DeriveInstrument = z.infer<typeof DeriveInstrumentSchema>;
