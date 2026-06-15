import type { NestedChainResponse } from './types.js';

export type OptionRight = 'call' | 'put';

export interface TradfiInstrument {
  underlying: string;
  expiry: string; // YYYY-MM-DD
  strike: number;
  right: OptionRight;
  occSymbol: string;
  streamerSymbol: string;
  canonical: string;
  multiplier: number;
  rootSymbol: string;
  settlementType: 'physical' | 'cash';
  expirationType: string | null;
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

export function nestedChainToInstruments(
  data: NestedChainResponse['data'],
): TradfiInstrument[] {
  const out: TradfiInstrument[] = [];

  for (const item of data.items) {
    const underlying = item['underlying-symbol'];
    const rootSymbol = item['root-symbol'] ?? underlying;
    const multiplier = item['shares-per-contract'] ?? 100;

    for (const exp of item.expirations) {
      const expiry = exp['expiration-date'];
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
            strike: strikePrice,
            right,
            occSymbol: occ,
            streamerSymbol: streamer,
            canonical: buildCanonical(underlying, expiry, strikePrice, right),
            multiplier,
            rootSymbol,
            settlementType,
            expirationType,
          });
        }
      }
    }
  }

  return out;
}
