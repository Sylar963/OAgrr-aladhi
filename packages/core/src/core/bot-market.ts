import type { BotMarketQuery, BotMarketResponse, VenueId } from '@oggregator/protocol';

export function assessBotMarket(
  chain: BotMarketResponse['chain'],
  query: BotMarketQuery,
  states: Partial<Record<VenueId, string>>,
  now: number,
): Pick<BotMarketResponse, 'quality' | 'venues' | 'dataReady'> {
  const quality: BotMarketResponse['quality'] = [];
  for (const row of chain.strikes)
    for (const right of ['call', 'put'] as const) {
      for (const venue of query.venues) {
        const quote = row[right].venues[venue];
        if (!quote) continue;
        const execution = quote.execution;
        const asOfMs = quote.asOfMs ?? null;
        const ageMs = asOfMs === null ? null : now - asOfMs;
        const reasons: string[] = [];
        if (ageMs === null || asOfMs === 0) reasons.push('missing-timestamp');
        else if (ageMs < -1000) reasons.push('future-timestamp');
        else if (ageMs > query.maxQuoteAgeMs) reasons.push('stale-quote');
        if (chain.expiryTs === null || chain.expiryTs <= now)
          reasons.push('missing-or-expired-expiry');
        if (!execution) reasons.push('missing-contract-metadata');
        const bid = execution?.bidUsd;
        const ask = execution?.askUsd;
        if (!(bid != null && bid > 0 && ask != null && ask > 0))
          reasons.push('missing-two-sided-quote');
        else if (bid > ask) reasons.push('crossed-quote');
        else if ((100 * (ask - bid)) / ((ask + bid) / 2) > query.maxSpreadPct)
          reasons.push('spread-limit');
        if (
          !(
            execution?.bidSize != null &&
            execution.bidSize > 0 &&
            execution.askSize != null &&
            execution.askSize > 0
          )
        )
          reasons.push('missing-sized-quote');
        if (
          query.requireGreeks &&
          [quote.markIv, quote.delta, quote.gamma, quote.theta, quote.vega].some(
            (value) => value == null || !Number.isFinite(value),
          )
        )
          reasons.push('missing-greeks');
        if (states[venue] !== 'connected' && states[venue] !== 'polling')
          reasons.push('venue-not-live');
        quality.push({
          venue,
          strike: row.strike,
          right,
          exchangeSymbol: execution?.exchangeSymbol ?? null,
          asOfMs,
          ageMs,
          eligible: reasons.length === 0,
          reasons,
          greekBasis:
            venue === 'thalex' ? 'black76-r0-derived-gamma-vega-theta' : 'venue-or-adapter',
        });
      }
    }
  const venues = query.venues.map((venue) => ({
    venue,
    quotes: quality.filter((quote) => quote.venue === venue).length,
    eligibleQuotes: quality.filter((quote) => quote.venue === venue && quote.eligible).length,
    state: states[venue] ?? 'unknown',
  }));
  return { quality, venues, dataReady: venues.every((venue) => venue.eligibleQuotes > 0) };
}
