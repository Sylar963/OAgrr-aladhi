import type { PerpTickerSnapshot } from '@oggregator/core';
import type {
  CryptoSectorBasket,
  CryptoSectorQuote,
  CryptoSectorsResponse,
} from '@oggregator/protocol';
import { memberDef, type SectorBasketDef, type SectorMemberDef } from './baskets.js';

interface BoardInput {
  snapshot: PerpTickerSnapshot | null;
  /** Options underlyings per venue, as `/api/underlyings` reports them. */
  venueUnderlyings: readonly { venue: string; underlyings: readonly string[] }[];
  tape: readonly (string | SectorMemberDef)[];
  baskets: readonly SectorBasketDef[];
}

export function buildSectorBoard({
  snapshot,
  venueUnderlyings,
  tape,
  baskets,
}: BoardInput): CryptoSectorsResponse {
  const venuesByBase = new Map<string, string[]>();
  for (const { venue, underlyings } of venueUnderlyings) {
    for (const base of new Set(underlyings.map((u) => u.split('_')[0]!))) {
      const list = venuesByBase.get(base) ?? [];
      list.push(venue);
      venuesByBase.set(base, list);
    }
  }

  const quote = (member: string | SectorMemberDef): CryptoSectorQuote => {
    const def = memberDef(member);
    const ticker = snapshot?.tickers.get(def.bybit);
    return {
      symbol: def.symbol,
      label: def.label,
      last: ticker ? ticker.lastPrice / def.scale : null,
      change: ticker ? ticker.change24hPct : null,
      optionVenues: [...(venuesByBase.get(def.symbol) ?? [])].sort(),
    };
  };

  const ranked = baskets
    .map((def): CryptoSectorBasket => {
      const members = def.members.map(quote).sort((a, b) => nullsLastDesc(a.change, b.change));
      const moves = members.flatMap((m) => (m.change == null ? [] : [m.change]));
      return {
        id: def.id,
        name: def.name,
        rank: null,
        mean: moves.length > 0 ? moves.reduce((a, b) => a + b, 0) / moves.length : null,
        median: median(moves),
        green: moves.filter((m) => m > 0).length,
        priced: moves.length,
        members,
      };
    })
    .sort((a, b) => nullsLastDesc(a.mean, b.mean));

  let rank = 0;
  for (const b of ranked) if (b.mean != null) b.rank = ++rank;

  return {
    asOf: snapshot?.fetchedAt ?? null,
    venueCount: venueUnderlyings.length,
    tape: tape.map(quote),
    baskets: ranked,
  };
}

function nullsLastDesc(a: number | null, b: number | null): number {
  if (a == null) return b == null ? 0 : 1;
  if (b == null) return -1;
  return b - a;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
