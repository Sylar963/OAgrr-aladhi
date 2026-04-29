import { z } from 'zod';

// ── Tastytrade REST schemas ──────────────────────────────────────
// Source: references/options-docs/tastytrade/rest/

export const TastytradeSessionResponseSchema = z.object({
  data: z.object({
    'session-token': z.string(),
    'remember-token': z.string().nullable().optional(),
    user: z
      .object({
        email: z.string().optional(),
        username: z.string().optional(),
        'external-id': z.string().optional(),
      })
      .partial()
      .optional(),
  }),
});
export type TastytradeSessionResponse = z.infer<typeof TastytradeSessionResponseSchema>;

export const TastytradeQuoteTokenResponseSchema = z.object({
  data: z.object({
    token: z.string(),
    'dxlink-url': z.string(),
    'streamer-url': z.string().optional(),
    level: z.string().optional(),
    'expires-at': z.string().optional(),
  }),
});
export type TastytradeQuoteTokenResponse = z.infer<typeof TastytradeQuoteTokenResponseSchema>;

// GET /option-chains/{symbol}/nested
// Captures: by expiration → by strike → call/put with both OCC + streamer symbols
export const TastytradeNestedStrikeSchema = z.object({
  'strike-price': z.string(),
  call: z.string().optional(),
  put: z.string().optional(),
  'call-streamer-symbol': z.string().optional(),
  'put-streamer-symbol': z.string().optional(),
});
export type TastytradeNestedStrike = z.infer<typeof TastytradeNestedStrikeSchema>;

export const TastytradeNestedExpirationSchema = z.object({
  'expiration-type': z.string().optional(),
  'expiration-date': z.string(),
  'days-to-expiration': z.number().optional(),
  'settlement-type': z.string().optional(),
  strikes: z.array(TastytradeNestedStrikeSchema),
});
export type TastytradeNestedExpiration = z.infer<typeof TastytradeNestedExpirationSchema>;

export const TastytradeNestedChainSchema = z.object({
  data: z.object({
    items: z.array(
      z.object({
        'underlying-symbol': z.string(),
        'root-symbol': z.string().optional(),
        'option-chain-type': z.string().optional(),
        'shares-per-contract': z.number().optional(),
        expirations: z.array(TastytradeNestedExpirationSchema),
      }),
    ),
  }),
});
export type TastytradeNestedChain = z.infer<typeof TastytradeNestedChainSchema>;

// ── DXLink WS frames ─────────────────────────────────────────────
// Source: references/options-docs/tastytrade/dxlink/

export const DxLinkFrameSchema = z.object({
  type: z.string(),
  channel: z.number().optional(),
});
export type DxLinkFrame = z.infer<typeof DxLinkFrameSchema>;

// FEED_DATA emits arrays per event-type — Quote, Greeks, Trade, Summary
export const DxLinkQuoteEventSchema = z.tuple([
  z.literal('Quote'),
  z.array(z.unknown()),
]);
export type DxLinkQuoteEvent = z.infer<typeof DxLinkQuoteEventSchema>;
