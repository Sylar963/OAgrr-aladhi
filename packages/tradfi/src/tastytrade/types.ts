import { z } from 'zod';

const num = z.number().nullable().optional();

export const OAuthTokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.string().optional(),
  expires_in: z.number(),
  refresh_token: z.string().optional(),
});
export type OAuthTokenResponse = z.infer<typeof OAuthTokenResponseSchema>;

export const QuoteTokenResponseSchema = z.object({
  data: z.object({
    token: z.string(),
    'dxlink-url': z.string(),
    'websocket-url': z.string().optional(),
    level: z.string().optional(),
    'expires-at': z.string().optional(),
  }),
});
export type QuoteTokenResponse = z.infer<typeof QuoteTokenResponseSchema>;

export const NestedStrikeSchema = z.object({
  'strike-price': z.string(),
  call: z.string().optional(),
  put: z.string().optional(),
  'call-streamer-symbol': z.string().optional(),
  'put-streamer-symbol': z.string().optional(),
});

export const NestedExpirationSchema = z.object({
  'expiration-date': z.string(),
  'days-to-expiration': z.number().optional(),
  'settlement-type': z.string().optional(),
  'expiration-type': z.string().optional(),
  strikes: z.array(NestedStrikeSchema),
});

export const NestedChainResponseSchema = z.object({
  data: z.object({
    items: z.array(
      z.object({
        'underlying-symbol': z.string(),
        'root-symbol': z.string().optional(),
        'option-chain-type': z.string().optional(),
        'shares-per-contract': z.number().optional(),
        expirations: z.array(NestedExpirationSchema),
      }),
    ),
  }),
});
export type NestedChainResponse = z.infer<typeof NestedChainResponseSchema>;

export const MarketDatumSchema = z.object({
  symbol: z.string(),
  instrumentType: z.string().optional(),
  bid: num, ask: num, bidSize: num, askSize: num,
  mid: num, mark: num, last: num, volume: num,
  open: num, dayHighPrice: num, dayLowPrice: num, close: num, prevClose: num,
  tradingHalted: z.boolean().nullable().optional(),
});
export type MarketDatum = z.infer<typeof MarketDatumSchema>;

export const MarketDataResponseSchema = z.object({
  data: z.object({ items: z.array(MarketDatumSchema) }),
});
export type MarketDataResponse = z.infer<typeof MarketDataResponseSchema>;
