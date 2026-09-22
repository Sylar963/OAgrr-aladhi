import { z } from 'zod';

export const DerivePositionSchema = z.object({
  instrument_name: z.string(),
  instrument_type: z.enum(['option', 'perp', 'erc20']),
  amount: z.string(),
  average_price: z.string(),
  average_price_excl_fees: z.string().optional(),
  realized_pnl: z.string().optional(),
  total_fees: z.string().optional(),
  unrealized_pnl_excl_fees: z.string().optional(),
  mark_price: z.string(),
  index_price: z.string(),
  creation_timestamp: z.number().int(),
  delta: z.string().optional(),
  gamma: z.string().optional(),
  theta: z.string().optional(),
  vega: z.string().optional(),
  unrealized_pnl: z.string().optional(),
});
export type DerivePosition = z.infer<typeof DerivePositionSchema>;

export const DerivePositionsResponseSchema = z.object({
  positions: z.array(DerivePositionSchema),
  subaccount_id: z.number().int(),
});
export type DerivePositionsResponse = z.infer<typeof DerivePositionsResponseSchema>;

export const DeriveTradeSchema = z.object({
  trade_id: z.string(),
  order_id: z.string().nullable().optional(),
  quote_id: z.string().nullable().optional(),
  rfq_id: z.string().nullable().optional(),
  instrument_name: z.string(),
  direction: z.enum(['buy', 'sell']),
  trade_amount: z.string(),
  trade_price: z.string(),
  trade_fee: z.string().nullable().optional(),
  realized_pnl: z.string().nullable().optional(),
  liquidity_role: z.enum(['maker', 'taker']).nullable().optional(),
  timestamp: z.number().int(),
});
export type DeriveTrade = z.infer<typeof DeriveTradeSchema>;

export const DeriveTradeHistoryResponseSchema = z.object({
  trades: z.array(DeriveTradeSchema),
  subaccount_id: z.number().int(),
  pagination: z.object({
    count: z.number().int().nonnegative(),
    num_pages: z.number().int().nonnegative(),
  }),
});
export type DeriveTradeHistoryResponse = z.infer<typeof DeriveTradeHistoryResponseSchema>;

export const DeriveJsonRpcEnvelopeSchema = z.object({
  result: z.unknown().optional(),
  error: z.object({ code: z.number(), message: z.string() }).optional(),
});
export type DeriveJsonRpcEnvelope = z.infer<typeof DeriveJsonRpcEnvelopeSchema>;
