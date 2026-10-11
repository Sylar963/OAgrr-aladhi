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
