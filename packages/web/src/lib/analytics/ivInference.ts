import type { VenueQuote } from '@shared/enriched';
import { impliedVolBlack76, type OptionRight } from './blackScholes';

export interface IvInferenceContext {
  forward: number;
  strike: number;
  T: number;
  right: OptionRight;
}

// Venues differ in what IV they publish. Thalex sends only markIv. Coincall
// and some others publish bid/ask prices but no matching bid/ask IV. Rather
// than dropping those venues from cross-venue routing (a real aggregator
// loss — Thalex liquidity is meaningful), we invert Black-76 on the
// price the venue does send to recover the IV it implicitly quotes.
//
// Pure function — returns a new VenueQuote with null IV fields patched where
// possible. Leaves the quote untouched if the price itself is null or zero
// (zero prices mean "no market", not "free").
export function inferMissingIv(quote: VenueQuote, ctx: IvInferenceContext): VenueQuote {
  const patched: VenueQuote = { ...quote };

  if (patched.bidIv == null && isValidPrice(quote.bid)) {
    patched.bidIv = impliedVolBlack76({
      marketPrice: quote.bid,
      forward: ctx.forward,
      strike: ctx.strike,
      T: ctx.T,
      right: ctx.right,
    });
  }

  if (patched.askIv == null && isValidPrice(quote.ask)) {
    patched.askIv = impliedVolBlack76({
      marketPrice: quote.ask,
      forward: ctx.forward,
      strike: ctx.strike,
      T: ctx.T,
      right: ctx.right,
    });
  }

  if (patched.markIv == null && isValidPrice(quote.mid)) {
    patched.markIv = impliedVolBlack76({
      marketPrice: quote.mid,
      forward: ctx.forward,
      strike: ctx.strike,
      T: ctx.T,
      right: ctx.right,
    });
  }

  return patched;
}

function isValidPrice(p: number | null): p is number {
  return p != null && p > 0 && Number.isFinite(p);
}
