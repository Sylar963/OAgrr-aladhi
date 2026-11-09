import { z } from 'zod';

const numStr = z.string().optional();

// GET /v1/positions → responses.PositionResp. Numerics are strings, timestamps unix ms.
export const ParadexPositionSchema = z
  .object({
    id: z.string(),
    market: z.string(),
    status: z.enum(['OPEN', 'CLOSED']),
    side: z.enum(['LONG', 'SHORT']).optional(),
    size: z.string(),
    average_entry_price: numStr,
    average_entry_price_usd: numStr,
    realized_positional_pnl: numStr,
    unrealized_pnl: numStr,
    unrealized_funding_pnl: numStr,
    created_at: z.number().optional(),
    last_updated_at: z.number().optional(),
  })
  .passthrough();
export type ParadexPosition = z.infer<typeof ParadexPositionSchema>;

export const ParadexPositionsResponseSchema = z.object({
  results: z.array(ParadexPositionSchema),
});

// Readonly tokens are JWTs; `sub` is the Paradex account address, `exp` unix seconds.
export const ParadexJwtClaimsSchema = z
  .object({ sub: z.string().min(1), exp: z.number().int().positive() })
  .passthrough();
export type ParadexJwtClaims = z.infer<typeof ParadexJwtClaimsSchema>;

// GET /v1/account/history?type=value → parallel arrays of account value and timestamps.
export const ParadexAccountHistorySchema = z.object({
  data: z.array(z.number()),
  timestamps: z.array(z.number()),
});
export type ParadexAccountHistory = z.infer<typeof ParadexAccountHistorySchema>;

const decimal = z.string().regex(/^-?\d+(?:\.\d+)?$/).transform(Number).pipe(z.number().finite());
const optionalDecimal = decimal.nullish().transform((value) => value ?? null);
const timestamp = z.number().int().nonnegative().nullish().transform((value) => value ?? null);

export const ParadexAccountSchema = z.object({
  account_value: decimal,
  free_collateral: optionalDecimal,
  initial_margin_requirement: optionalDecimal,
  maintenance_margin_requirement: optionalDecimal,
  settlement_asset: z.string().nullish(),
  updated_at: timestamp,
});

export const ParadexRfqListSchema = z.object({
  next: z.string().nullish(),
  results: z.array(z.object({
    id: z.string().min(1),
    state: z.string(),
    quantity: decimal.pipe(z.number().positive()),
    filled_quantity: optionalDecimal.pipe(z.number().nonnegative().nullable()),
    created_at: timestamp,
    expires_at: timestamp,
    legs: z.array(z.object({
      market: z.string(),
      side: z.enum(['BUY', 'SELL']),
      ratio: decimal.pipe(z.number().positive()),
      price: optionalDecimal,
    })),
  })),
});

export const ParadexRfqBboSchema = z.object({
  rfq_id: z.string().optional(),
  best_bid_price: optionalDecimal,
  best_ask_price: optionalDecimal,
  best_bid_quantity: optionalDecimal.pipe(z.number().nonnegative().nullable()),
  best_ask_quantity: optionalDecimal.pipe(z.number().nonnegative().nullable()),
  mark_price: optionalDecimal,
  created_at: timestamp,
});
