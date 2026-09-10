import type { VenueId } from '@oggregator/core';
import { type ChainRuntimeRegistry, VENUE_IDS } from '@oggregator/core';
import type { QuoteBook, QuoteKey, QuoteProvider } from '../gateways/quote-provider.js';

export class RuntimeQuoteProvider implements QuoteProvider {
  constructor(private readonly registry: ChainRuntimeRegistry) {}

  async getBooks(key: QuoteKey, venues: VenueId[]): Promise<QuoteBook[]> {
    const requestedVenues = venues.length > 0 ? venues : [...VENUE_IDS];
    const { runtime, release } = await this.registry.acquire({
      underlying: key.underlying,
      expiry: key.expiry,
      venues: requestedVenues,
    });
    try {
      const snapshot = await runtime.fetchSnapshotData();
      const strike = snapshot.strikes.find((s) => s.strike === key.strike);
      if (!strike) return [];
      const side = key.optionRight === 'call' ? strike.call : strike.put;
      const books: QuoteBook[] = [];
      for (const [venueId, quote] of Object.entries(side.venues)) {
        const venue = venueId as VenueId;
        if (!requestedVenues.includes(venue)) continue;
        const execution = quote?.execution;
        if (!execution) continue;
        books.push({
          venue,
          exchangeSymbol: execution.exchangeSymbol,
          settleCurrency: execution.settleCurrency,
          inverse: execution.inverse,
          quantityUnit: execution.quantityUnit,
          contractMultiplierBase: execution.contractMultiplierBase,
          nativeMinQuantity: execution.nativeMinQuantity,
          nativeQuantityStep: execution.nativeQuantityStep,
          nativePriceTick: execution.nativePriceTick,
          minQuantity: execution.minQuantity,
          quantityStep: execution.quantityStep,
          bidUsd: execution.bidUsd,
          askUsd: execution.askUsd,
          markUsd: execution.markUsd,
          markIv: quote.markIv,
          underlyingPriceUsd: snapshot.stats.forwardPriceUsd ?? snapshot.stats.indexPriceUsd,
          bidTakerFeeUsd: execution.bidTakerFeeUsd,
          askTakerFeeUsd: execution.askTakerFeeUsd,
          asOfMs: quote.asOfMs ?? null,
          bidSize: execution.bidSize,
          askSize: execution.askSize,
        });
      }
      return books;
    } finally {
      await release();
    }
  }

  async getMark(key: QuoteKey): Promise<number | null> {
    const books = await this.getBooks(key, [...VENUE_IDS]);
    const marks = books.map((b) => b.markUsd).filter((m): m is number => m != null);
    if (marks.length === 0) return null;
    return marks.reduce((sum, m) => sum + m, 0) / marks.length;
  }
}
