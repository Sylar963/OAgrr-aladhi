import { describe, expect, it } from 'vitest';

import {
  decodeParadexJwtClaims,
  paradexPositionToLeg,
  parseParadexOptionSymbol,
} from './codec.js';
import { ParadexPositionsResponseSchema } from './types.js';

// Shape from references/options-docs/paradex/private/api_prod_account_get-positions.md,
// with the market switched to a live option symbol.
const docPosition = {
  account: 'string',
  average_entry_price: '29001.34',
  average_entry_price_usd: '29001.34',
  average_exit_price: '29001.34',
  cached_funding_index: '1234.3',
  closed_at: 1681493939981,
  cost: '-10005.4623',
  cost_usd: '-10005.4623',
  created_at: 1681493939981,
  id: '1234234',
  last_fill_id: '1234234',
  last_updated_at: 1681493939981,
  leverage: 'string',
  liquidation_price: 'string',
  market: 'BTC-USD-PERP',
  realized_positional_funding_pnl: '12.234',
  realized_positional_pnl: '-123.23',
  seq_no: 1681471234972000000,
  side: 'SHORT',
  size: '-0.345',
  status: 'OPEN',
  unrealized_funding_pnl: '12.234',
  unrealized_pnl: '-123.23',
};

const docParsed = ParadexPositionsResponseSchema.parse({ results: [docPosition] }).results[0]!;

describe('parseParadexOptionSymbol', () => {
  it('parses option market symbols', () => {
    expect(parseParadexOptionSymbol('SOL-USD-27NOV26-164-P')).toEqual({
      underlying: 'SOL',
      expiry: '2026-11-27',
      strike: 164,
      optionRight: 'put',
    });
    expect(parseParadexOptionSymbol('MSTR-USD-3OCT26-167_5-C')).toEqual({
      underlying: 'MSTR',
      expiry: '2026-10-03',
      strike: 167.5,
      optionRight: 'call',
    });
  });

  it('rejects perps and spot', () => {
    expect(parseParadexOptionSymbol('BTC-USD-PERP')).toBeNull();
    expect(parseParadexOptionSymbol('ETH-USDC')).toBeNull();
  });
});

describe('paradexPositionToLeg', () => {
  it('accepts the documented positions payload', () => {
    expect(ParadexPositionsResponseSchema.safeParse({ results: [docPosition] }).success).toBe(true);
  });

  it('skips non-option markets', () => {
    expect(paradexPositionToLeg(docParsed)).toBeNull();
  });

  it('maps an open option position and backs the mark out of unrealized P&L', () => {
    const leg = paradexPositionToLeg(
      {
        ...docParsed,
        market: 'BTC-USD-27NOV26-120000-C',
        size: '-0.5',
        average_entry_price_usd: '2000',
        unrealized_pnl: '100',
        unrealized_funding_pnl: '0',
        realized_positional_pnl: '-12.5',
      },
      1_790_000_000_000,
    );
    expect(leg).toMatchObject({
      legId: 'paradex|BTC|2026-11-27|120000|call',
      size: -0.5,
      entryPriceUsd: 2000,
      realizedPnlUsd: -12.5,
      venueHint: 'paradex',
      source: 'paradex',
      venueMarkPriceUsd: 1800,
      venueMarkTs: 1_790_000_000_000,
    });
  });

  it('drops closed positions', () => {
    expect(
      paradexPositionToLeg({ ...docParsed, market: 'BTC-USD-27NOV26-120000-C', status: 'CLOSED' }),
    ).toBeNull();
  });
});

describe('decodeParadexJwtClaims', () => {
  it('reads account and expiry from the token payload', () => {
    const payload = Buffer.from(JSON.stringify({ sub: '0xabc', exp: 1_800_000_000 })).toString('base64url');
    expect(decodeParadexJwtClaims(`header.${payload}.sig`)).toMatchObject({ sub: '0xabc', exp: 1_800_000_000 });
  });

  it('rejects malformed tokens', () => {
    expect(decodeParadexJwtClaims('not-a-jwt')).toBeNull();
    expect(decodeParadexJwtClaims('a.b.c')).toBeNull();
  });
});
