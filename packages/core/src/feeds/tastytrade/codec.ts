import {
  DxLinkFrameSchema,
  TastytradeNestedChainSchema,
  TastytradeQuoteTokenResponseSchema,
  TastytradeSessionResponseSchema,
} from './types.js';

export function parseSessionResponse(raw: unknown) {
  return TastytradeSessionResponseSchema.safeParse(raw);
}

export function parseQuoteTokenResponse(raw: unknown) {
  return TastytradeQuoteTokenResponseSchema.safeParse(raw);
}

export function parseNestedChain(raw: unknown) {
  return TastytradeNestedChainSchema.safeParse(raw);
}

export function parseDxLinkFrame(raw: unknown) {
  return DxLinkFrameSchema.safeParse(raw);
}

/**
 * Build the canonical oggregator symbol from a Tastytrade OCC string.
 *
 * OCC format: `NVDA  260117C00200000` (root padded to 6, yymmdd, C/P, strike×1000 padded to 8).
 * Canonical:  `NVDA/USD:USD-260117-200-C`
 */
export function occToCanonical(_occ: string): string {
  throw new Error('occToCanonical not implemented');
}

/**
 * DXFeed streamer symbol (e.g. `.NVDA260117C200`) for FEED_SUBSCRIPTION.
 */
export function canonicalToStreamerSymbol(_canonical: string): string {
  throw new Error('canonicalToStreamerSymbol not implemented');
}
