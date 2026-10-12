import type {
  TradfiSectorBasket,
  TradfiSectorQuote,
  TradfiSectorsResponse,
} from '@oggregator/protocol';
import type { TradfiStore } from '../runtime/store.js';
import type { SectorBasketDef, TapeDef } from './baskets.js';

const DAY_MS = 86_400_000;

interface BoardInput {
  store: TradfiStore;
  tape: readonly TapeDef[];
  baskets: readonly SectorBasketDef[];
}

export function buildSectorBoard({ store, tape, baskets }: BoardInput): TradfiSectorsResponse {
  const optionable = new Set(store.listUnderlyings());
  let asOf = 0;
  const dayIdCounts = new Map<number, number>();

  const quote = (symbol: string, label: string): TradfiSectorQuote => {
    const session = store.getSession(symbol);
    const last = session?.lastTrade ?? store.getSpot(symbol);
    const prevClose = session?.prevClose ?? null;
    if (session) {
      asOf = Math.max(asOf, session.ts);
      if (session.prevDayId != null) {
        dayIdCounts.set(session.prevDayId, (dayIdCounts.get(session.prevDayId) ?? 0) + 1);
      }
    }
    return {
      symbol,
      label,
      last,
      prevClose,
      change: last != null && prevClose != null ? last / prevClose - 1 : null,
      hasOptions: optionable.has(symbol),
    };
  };

  const ranked = baskets
    .map((def): TradfiSectorBasket => {
      const members = def.symbols.map((s) => quote(s, s)).sort(byChangeDesc);
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

  const tapeQuotes = tape.map((t) => quote(t.symbol, t.label));

  let prevDayId: number | null = null;
  let best = 0;
  for (const [id, n] of dayIdCounts) {
    if (n > best) {
      best = n;
      prevDayId = id;
    }
  }

  return {
    asOf: asOf > 0 ? asOf : null,
    prevCloseDate: prevDayId != null ? new Date(prevDayId * DAY_MS).toISOString().slice(0, 10) : null,
    tape: tapeQuotes,
    baskets: ranked,
  };
}

function byChangeDesc(a: TradfiSectorQuote, b: TradfiSectorQuote): number {
  return nullsLastDesc(a.change, b.change);
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
