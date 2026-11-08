import { formatThalexOptionInstrument, type ThalexMarginPreviewRequest } from '@oggregator/core';
import { z } from 'zod';

import type { AssistantMarketDataReader, MarketReadResult } from './market-data-reader.js';
import type { ExecutableQuoteSet } from './market-data-compaction.js';
import { cents, selectExecutableQuote, type StructureToolPortfolioAccess } from './structure-tool-support.js';
import { toolErrorPayload, type ToolErrorCode } from './tool-errors.js';

export const ThalexMarginPreviewToolInputSchema = z.object({
  portfolioRef: z.string().min(1).max(64),
  underlying: z.string().min(1).max(20),
  legs: z.array(z.object({
    expiry: z.iso.date(),
    strike: z.number().positive(),
    right: z.enum(['call', 'put']),
    side: z.enum(['buy', 'sell']),
    size: z.number().positive().max(10_000),
  })).min(1).max(4),
});
type Input = z.infer<typeof ThalexMarginPreviewToolInputSchema>;

function failure(code: ToolErrorCode, error: string): MarketReadResult<never> {
  return toolErrorPayload(code, error);
}

export async function runThalexMarginPreviewTool(
  reader: AssistantMarketDataReader,
  portfolio: StructureToolPortfolioAccess,
  args: Input,
  now: () => number = Date.now,
): Promise<MarketReadResult<Record<string, unknown>>> {
  const resolution = portfolio.refs.resolve(args.portfolioRef);
  if (!resolution.ok) return failure('portfolio_ref_unresolved', 'The portfolio reference is unknown or expired.');
  const { scope } = resolution;
  const underlying = args.underlying.trim().toUpperCase();
  if (scope.source !== 'thalex' || scope.network !== 'mainnet') {
    return failure('unavailable', 'Margin preview currently requires a connected Thalex mainnet portfolio.');
  }
  if (scope.underlying != null && scope.underlying.toUpperCase() !== underlying) {
    return failure('invalid_arguments', 'The underlying does not match this portfolio reference.');
  }
  if (portfolio.previewThalexMargin == null) return failure('unavailable', 'The Thalex margin preview reader is not configured.');
  const instruments = args.legs.map((leg) => formatThalexOptionInstrument({
    underlying, expiry: leg.expiry, strike: leg.strike, optionRight: leg.right,
  }));
  if (instruments.some((name) => name == null) || new Set(instruments).size !== instruments.length) {
    return failure('invalid_arguments', 'Use distinct, valid option instruments in a margin preview.');
  }
  const quoteSets = new Map<string, MarketReadResult<ExecutableQuoteSet>>();
  await Promise.all([...new Set(args.legs.map((leg) => leg.expiry))].map(async (expiry) => {
    const strikes = args.legs.filter((leg) => leg.expiry === expiry).map((leg) => leg.strike);
    quoteSets.set(expiry, await reader.executableQuotes(underlying, expiry, strikes));
  }));
  const quotes: Array<{ instrument: string; side: 'buy' | 'sell'; size: number; priceUsd: number; asOf: string | null }> = [];
  for (const [index, leg] of args.legs.entries()) {
    const set = quoteSets.get(leg.expiry);
    if (set == null) return failure('no_quote', 'The option chain was not returned.');
    if (!set.ok) return set;
    const selected = selectExecutableQuote(set.data, { ...leg, venues: ['thalex'] });
    if (!selected.ok) return failure('no_quote', selected.error);
    const quote = selected.value;
    const priceUsd = leg.side === 'buy' ? quote.quote.askUsd : quote.quote.bidUsd;
    const instrument = instruments[index];
    if (priceUsd == null || instrument == null) return failure('no_quote', 'The Thalex executable price is missing.');
    quotes.push({ instrument, side: leg.side, size: leg.size, priceUsd, asOf: quote.echo.asOf });
  }
  const first = quotes[0];
  if (first == null) return failure('invalid_arguments', 'At least one leg is required.');
  const amount = Math.min(...quotes.map((quote) => quote.size));
  const request: ThalexMarginPreviewRequest = quotes.length === 1
    ? { instrument_name: first.instrument, price: first.priceUsd, amount }
    : {
        legs: quotes.map((quote) => ({
          instrument_name: quote.instrument,
          quantity: (quote.side === 'buy' ? 1 : -1) * quote.size / amount,
        })),
        price: quotes.reduce((sum, quote) => sum + (quote.side === 'buy' ? 1 : -1) * quote.size / amount * quote.priceUsd, 0),
        amount,
      };
  try {
    const preview = await portfolio.previewThalexMargin(scope, request);
    if (preview == null) return failure('unavailable', 'The Thalex session is disconnected or its network changed.');
    const selectedSide = quotes.length === 1 && first.side === 'sell' ? 'with_sell' : 'with_buy';
    const current = preview.current.required_margin;
    const proposed = preview[selectedSide].required_margin;
    return {
      ok: true,
      data: {
        venue: 'thalex', network: scope.network, retrievedAt: new Date(now()).toISOString(),
        method: 'private/required_margin_for_order', comparisonKind: 'order_insertion', quotes,
        currentRequiredMarginUsd: cents(current), withOrderRequiredMarginUsd: cents(proposed),
        requiredMarginChangeUsd: cents(proposed - current),
        notes: [
          'Thalex models inserting this hypothetical order into the existing account, including existing orders; this is not a filled-position simulation or a guaranteed margin release.',
          'Positive requiredMarginChangeUsd means more required margin; negative means less.',
          'Outright bid/ask quotes price the request; a combination quote and execution are not guaranteed. Venue combination constraints can reject a package.',
          'This result is not maximum expiry loss, maintenance margin or a liquidation guarantee. Use evaluate_structure separately for portfolio payoff.',
        ],
      },
    };
  } catch {
    return failure('upstream_error', 'Thalex could not preview this order. Check the live session, read permissions and combination constraints.');
  }
}
