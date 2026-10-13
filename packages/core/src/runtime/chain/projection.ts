import { buildComparisonChain } from '../../core/aggregator.js';
import type { BookLookup } from '../../core/dealer-book.js';
import {
  buildEnrichedChain,
  computeChainStats,
  computeGex,
  enrichComparisonRow,
  type EnrichedChainResponse,
  type EnrichedStrike,
} from '../../core/enrichment.js';
import type {
  ComparisonRow,
  SnapshotMeta,
  VenueDelta,
  VenueOptionChain,
} from '../../core/types.js';
import type { VenueId } from '../../types/common.js';

export interface ChainProjectionDelta {
  meta: SnapshotMeta;
  deltas: VenueDelta[];
  patch: {
    stats: EnrichedChainResponse['stats'];
    strikes: EnrichedStrike[];
    gex?: EnrichedChainResponse['gex'];
  };
}

// Lag is measured from each venue's newest quote, not the chain's oldest: illiquid contracts
// (empty books, venue timestamps that mark the last book change) can sit untouched for hours
// while the feed itself is current.
function snapshotMetaFromChains(venueChains: VenueOptionChain[]): SnapshotMeta {
  const generatedAt = Date.now();
  let maxQuoteTs = 0;
  let staleMs = 0;
  const venueLagMs: SnapshotMeta['venueLagMs'] = {};

  for (const chain of venueChains) {
    let newestTs = 0;
    for (const contract of Object.values(chain.contracts)) {
      const ts = contract.quote.timestamp ?? 0;
      if (ts > newestTs) newestTs = ts;
    }
    if (newestTs <= 0) continue;
    if (newestTs > maxQuoteTs) maxQuoteTs = newestTs;
    // Venue clocks can run slightly ahead of ours.
    const lag = Math.max(0, generatedAt - newestTs);
    venueLagMs[chain.venue] = lag;
    if (lag > staleMs) staleMs = lag;
  }

  return { generatedAt, maxQuoteTs, staleMs, venueLagMs };
}

function comparisonRowsMap(
  underlying: string,
  expiry: string,
  venueChains: VenueOptionChain[],
): Map<number, ComparisonRow> {
  const comparison = buildComparisonChain(underlying, expiry, venueChains);
  return new Map(comparison.rows.map((row) => [row.strike, row]));
}

function enrichedStrikesMap(rows: Map<number, ComparisonRow>): Map<number, EnrichedStrike> {
  return new Map(
    [...rows.values()]
      .sort((left, right) => left.strike - right.strike)
      .map((row) => [row.strike, enrichComparisonRow(row)]),
  );
}

export class ChainProjection {
  private venueChains = new Map<VenueId, VenueOptionChain>();
  private comparisonRows = new Map<number, ComparisonRow>();
  private enrichedStrikes = new Map<number, EnrichedStrike>();
  private missedSymbols = false;

  constructor(
    private readonly underlying: string,
    private readonly expiry: string,
    private readonly bookLookup?: BookLookup,
  ) {}

  loadSnapshot(venueChains: VenueOptionChain[]): EnrichedChainResponse {
    this.venueChains = new Map(venueChains.map((chain) => [chain.venue, chain]));
    this.comparisonRows = comparisonRowsMap(this.underlying, this.expiry, venueChains);
    this.enrichedStrikes = enrichedStrikesMap(this.comparisonRows);
    this.missedSymbols = false;

    return buildEnrichedChain(
      this.underlying,
      this.expiry,
      [...this.comparisonRows.values()],
      venueChains,
      this.bookLookup,
    );
  }

  /** True once a delta referenced a contract this projection was not loaded with (e.g. a new listing). */
  needsReload(): boolean {
    return this.missedSymbols;
  }

  buildSnapshotMeta(): SnapshotMeta {
    return snapshotMetaFromChains([...this.venueChains.values()]);
  }

  applyDeltas(deltas: VenueDelta[], options: { includeGex?: boolean } = {}): ChainProjectionDelta | null {
    if (deltas.length === 0) return null;

    const changedStrikes = new Set<number>();

    for (const delta of deltas) {
      const chain = this.venueChains.get(delta.venue);
      const contract = chain?.contracts[delta.symbol];
      if (chain == null || contract == null || !this.comparisonRows.has(contract.strike)) {
        this.missedSymbols = true;
        continue;
      }

      if (delta.quote != null) {
        contract.quote = { ...contract.quote, ...delta.quote };
      }
      if (delta.greeks != null) {
        contract.greeks = { ...contract.greeks, ...delta.greeks };
      }
      changedStrikes.add(contract.strike);
    }

    if (changedStrikes.size === 0) return null;

    for (const strike of changedStrikes) {
      this.enrichedStrikes.set(strike, enrichComparisonRow(this.comparisonRows.get(strike)!));
    }

    const venueChains = [...this.venueChains.values()];
    // Insertion order is strike-sorted from loadSnapshot and set() on an existing key keeps it.
    const strikes = [...this.enrichedStrikes.values()];
    const stats = computeChainStats(strikes, venueChains);
    const patchStrikes = [...changedStrikes]
      .sort((left, right) => left - right)
      .map((strike) => this.enrichedStrikes.get(strike))
      .filter((strike): strike is EnrichedStrike => strike != null);

    const patch: ChainProjectionDelta['patch'] = {
      stats,
      strikes: patchStrikes,
    };
    if (options.includeGex === true) {
      const spotPrice = stats.indexPriceUsd ?? stats.forwardPriceUsd ?? 0;
      patch.gex = computeGex(
        [...this.comparisonRows.values()],
        strikes,
        spotPrice,
        this.bookLookup,
      );
    }

    return {
      meta: snapshotMetaFromChains(venueChains),
      deltas,
      patch,
    };
  }
}
