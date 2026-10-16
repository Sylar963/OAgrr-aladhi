import { z } from 'zod';

// Paradex sends ALL market-data numerics as JSON strings; empty values arrive as ''.
// Keep them as strings here; coerce (string→number, ''→null) in state.ts via safeNum.
const numStr = z.string().nullable().optional();

const ParadexFeeSchema = z
  .object({ fee: numStr, fee_cap: numStr, fee_floor: numStr })
  .passthrough();

const ParadexMakerTakerSchema = z
  .object({ maker_fee: ParadexFeeSchema.optional(), taker_fee: ParadexFeeSchema.optional() })
  .passthrough();

export const ParadexMarketSchema = z
  .object({
    symbol: z.string(),
    base_currency: z.string(),
    quote_currency: z.string().optional(),
    settlement_currency: z.string().optional(),
    asset_kind: z.string(),
    option_type: z.string().nullable().optional(), // 'CALL' | 'PUT' (absent/empty for non-options)
    strike_price: numStr,
    expiry_at: z.number().optional(), // unix ms
    open_at: z.number().optional(), // unix ms
    price_tick_size: numStr,
    order_size_increment: numStr,
    min_notional: numStr,
    fee_config: z
      .object({
        api_fee: ParadexMakerTakerSchema.optional(),
        interactive_fee: ParadexMakerTakerSchema.optional(),
        rpi_fee: ParadexMakerTakerSchema.optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
export type ParadexMarket = z.infer<typeof ParadexMarketSchema>;

export const ParadexGreeksSchema = z
  .object({ delta: numStr, gamma: numStr, vega: numStr, theta: numStr, rho: numStr })
  .passthrough();

export const ParadexSummarySchema = z
  .object({
    symbol: z.string(),
    mark_price: numStr,
    last_traded_price: numStr,
    bid: numStr,
    bid_size: numStr,
    ask: numStr,
    ask_size: numStr,
    underlying_price: numStr,
    mark_iv: numStr,
    bid_iv: numStr,
    ask_iv: numStr,
    volume_24h: numStr,
    open_interest: numStr,
    funding_rate: numStr,
    greeks: ParadexGreeksSchema.nullable().optional(),
    created_at: z.number().optional(), // unix ms
  })
  .passthrough();
export type ParadexSummary = z.infer<typeof ParadexSummarySchema>;

/** Live SBE summary with decimals already decoded to numbers (same values as parsing the strings). */
export interface ParadexSummaryValues {
  symbol: string;
  mark_price: number | null;
  underlying_price: number | null;
  last_traded_price: number | null;
  volume_24h: number | null;
  open_interest: number | null;
  funding_rate: number | null;
  bid: number | null;
  ask: number | null;
  mark_iv: number | null;
  bid_iv: number | null;
  ask_iv: number | null;
  bid_size: number | null;
  ask_size: number | null;
  greeks: {
    delta: number | null;
    gamma: number | null;
    vega: number | null;
    theta: number | null;
    rho: number | null;
    volga: number | null;
    vanna: number | null;
  };
  created_at: number;
}

export const ParadexMarketsResponseSchema = z.object({ results: z.array(ParadexMarketSchema) });
export const ParadexSummaryResponseSchema = z.object({ results: z.array(ParadexSummarySchema) });

// Trade tape (FLOW) row. `side` is the explicit taker side (NOT sign-of-size);
// price/size are strings like every Paradex numeric; created_at is unix ms.
// trade_type ∈ FILL | LIQUIDATION | TRANSFER | SETTLE_MARKET | RPI | BLOCK_TRADE.
export const ParadexTradeSchema = z
  .object({
    id: z.string(),
    market: z.string(),
    side: z.enum(['BUY', 'SELL']),
    size: z.string(),
    price: z.string(),
    created_at: z.number(), // unix ms
    trade_type: z.string(),
  })
  .passthrough();
export type ParadexTrade = z.infer<typeof ParadexTradeSchema>;

export const ParadexTradesResponseSchema = z.object({ results: z.array(ParadexTradeSchema) });

// JSON-RPC control replies on the market-data socket (market data itself is SBE).
export const ParadexRpcResponseSchema = z
  .object({
    jsonrpc: z.literal('2.0'),
    id: z.number().optional(),
    result: z.unknown().optional(),
    error: z
      .object({ code: z.number(), message: z.string(), data: z.unknown().optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();
export type ParadexRpcResponse = z.infer<typeof ParadexRpcResponseSchema>;
