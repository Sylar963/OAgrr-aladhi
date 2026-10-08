import type { NestedChainResponse } from './types.js';

export type OptionRight = 'call' | 'put';

/** Premium tick that applies while the price is below `below` (null = no upper bound). */
export interface TickSize {
  below: number | null;
  value: number;
}

export interface TradfiInstrument {
  underlying: string;
  expiry: string; // YYYY-MM-DD
  expiryTs: number;
  strike: number;
  right: OptionRight;
  occSymbol: string;
  streamerSymbol: string;
  canonical: string;
  multiplier: number;
  rootSymbol: string;
  settlementType: 'physical' | 'cash';
  expirationType: string | null;
  tickSizes: TickSize[];
}

export function buildCanonical(
  underlying: string,
  expiry: string,
  strike: number,
  right: OptionRight,
): string {
  const yy = expiry.slice(2, 4);
  const mm = expiry.slice(5, 7);
  const dd = expiry.slice(8, 10);
  const rc = right === 'call' ? 'C' : 'P';
  return `${underlying}/USD:USD-${yy}${mm}${dd}-${strike}-${rc}`;
}

function mapSettlement(raw: string | undefined): 'physical' | 'cash' {
  return raw?.toLowerCase() === 'cash' ? 'cash' : 'physical';
}

// AM-settled index options (SPX, NDX monthlies) settle off the opening print;
// everything else settles at the 16:00 ET close.
function expiryTimestamp(expiry: string, settlement: string | undefined): number {
  return settlement?.toUpperCase() === 'AM'
    ? easternWallClockToUtcMs(expiry, 9, 30)
    : easternWallClockToUtcMs(expiry, 16, 0);
}

function easternWallClockToUtcMs(date: string, hour: number, minute: number): number {
  const asUtc = Date.parse(
    `${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`,
  );
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(asUtc));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const etAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return asUtc - (etAsUtc - asUtc);
}

function parseTickSizes(
  raw: NestedChainResponse['data']['items'][number]['tick-sizes'],
): TickSize[] {
  const out: TickSize[] = [];
  for (const t of raw ?? []) {
    const value = Number(t.value);
    const below = t.threshold == null ? null : Number(t.threshold);
    if (!(value > 0) || (below != null && !(below > 0))) return [];
    out.push({ below, value });
  }
  return out;
}

export function tickFor(ticks: readonly TickSize[], price: number | null): number | null {
  if (ticks.length === 0) return null;
  if (price == null) return ticks[0]!.value;
  return (ticks.find((t) => t.below == null || price < t.below) ?? ticks[ticks.length - 1]!).value;
}

export function nestedChainToInstruments(
  data: NestedChainResponse['data'],
): TradfiInstrument[] {
  const out: TradfiInstrument[] = [];

  for (const item of data.items) {
    const underlying = item['underlying-symbol'];
    const rootSymbol = item['root-symbol'] ?? underlying;
    const multiplier = item['shares-per-contract'] ?? 100;
    const tickSizes = parseTickSizes(item['tick-sizes']);

    for (const exp of item.expirations) {
      const expiry = exp['expiration-date'];
      const expiryTs = expiryTimestamp(expiry, exp['settlement-type']);
      const settlementType = mapSettlement(exp['settlement-type']);
      const expirationType = exp['expiration-type'] ?? null;

      for (const strike of exp.strikes) {
        const strikePrice = Number(strike['strike-price']);
        if (!Number.isFinite(strikePrice)) continue;

        const sides: Array<[OptionRight, string | undefined, string | undefined]> = [
          ['call', strike.call, strike['call-streamer-symbol']],
          ['put', strike.put, strike['put-streamer-symbol']],
        ];

        for (const [right, occ, streamer] of sides) {
          if (occ == null || streamer == null) continue;
          out.push({
            underlying,
            expiry,
            expiryTs,
            strike: strikePrice,
            right,
            occSymbol: occ,
            streamerSymbol: streamer,
            canonical: buildCanonical(underlying, expiry, strikePrice, right),
            multiplier,
            rootSymbol,
            settlementType,
            expirationType,
            tickSizes,
          });
        }
      }
    }
  }

  return out;
}
