import { describe, it, expect } from 'vitest';
import {
  PositionLegSchema,
  VolShockScenarioSchema,
  PortfolioWsClientMessageSchema,
  PortfolioWsServerMessageSchema,
} from './portfolio.js';

const validLeg = {
  legId: 'leg-1',
  underlying: 'BTC',
  expiry: '2026-03-27',
  strike: 70_000,
  optionRight: 'call',
  size: 1,
  entryPriceUsd: 1_500,
  entryIv: 0.55,
  realizedPnlUsd: 0,
  entryTs: 1_700_000_000_000,
  venueHint: 'deribit',
  source: 'manual',
} as const;

describe('PositionLegSchema', () => {
  it('round-trips a valid leg unchanged', () => {
    const result = PositionLegSchema.safeParse(validLeg);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(validLeg);
  });

  it('defaults realizedPnlUsd to 0 when omitted', () => {
    const { realizedPnlUsd: _omit, ...rest } = validLeg;
    const result = PositionLegSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.realizedPnlUsd).toBe(0);
  });

  it('rejects a zero size (must be non-zero)', () => {
    expect(PositionLegSchema.safeParse({ ...validLeg, size: 0 }).success).toBe(false);
  });

  it('accepts a negative size (short leg)', () => {
    expect(PositionLegSchema.safeParse({ ...validLeg, size: -2 }).success).toBe(true);
  });

  it('rejects a non-positive entryPriceUsd', () => {
    expect(PositionLegSchema.safeParse({ ...validLeg, entryPriceUsd: 0 }).success).toBe(false);
  });

  it('accepts a null venueHint and null entryIv', () => {
    expect(
      PositionLegSchema.safeParse({ ...validLeg, venueHint: null, entryIv: null }).success,
    ).toBe(true);
  });
});

describe('VolShockScenarioSchema', () => {
  it('accepts each scenario kind', () => {
    expect(VolShockScenarioSchema.safeParse({ kind: 'parallel', bumpVolPts: 5 }).success).toBe(true);
    expect(
      VolShockScenarioSchema.safeParse({ kind: 'skew_tilt', atmStrike: 70_000, slopePerLogK: 0.1 })
        .success,
    ).toBe(true);
    expect(
      VolShockScenarioSchema.safeParse({ kind: 'term_twist', pivotDays: 30, slopePerYear: 0.2 })
        .success,
    ).toBe(true);
    expect(
      VolShockScenarioSchema.safeParse({
        kind: 'atm_bump',
        atmStrike: 70_000,
        widthPct: 0.1,
        bumpVolPts: 3,
      }).success,
    ).toBe(true);
  });

  it('rejects an unknown scenario kind', () => {
    expect(VolShockScenarioSchema.safeParse({ kind: 'meltup', bumpVolPts: 5 }).success).toBe(false);
  });

  it('rejects a parallel scenario missing bumpVolPts', () => {
    expect(VolShockScenarioSchema.safeParse({ kind: 'parallel' }).success).toBe(false);
  });

  it('rejects a skew_tilt with a non-positive atmStrike', () => {
    expect(
      VolShockScenarioSchema.safeParse({ kind: 'skew_tilt', atmStrike: 0, slopePerLogK: 0.1 })
        .success,
    ).toBe(false);
  });
});

describe('PortfolioWsClientMessageSchema', () => {
  it('accepts subscribe and unsubscribe', () => {
    expect(PortfolioWsClientMessageSchema.safeParse({ type: 'subscribe', subscriptionId: 's1' }).success).toBe(
      true,
    );
    expect(
      PortfolioWsClientMessageSchema.safeParse({ type: 'unsubscribe', subscriptionId: 's1' }).success,
    ).toBe(true);
  });

  it('rejects an unknown message type', () => {
    expect(PortfolioWsClientMessageSchema.safeParse({ type: 'ping', subscriptionId: 's1' }).success).toBe(
      false,
    );
  });
});

describe('PortfolioWsServerMessageSchema', () => {
  it('accepts a hello message', () => {
    expect(
      PortfolioWsServerMessageSchema.safeParse({ type: 'hello', accountId: 'a1', serverTime: 1_000 })
        .success,
    ).toBe(true);
  });

  it('accepts an error message', () => {
    expect(
      PortfolioWsServerMessageSchema.safeParse({ type: 'error', code: 'BOOM', message: 'bad' })
        .success,
    ).toBe(true);
  });

  it('rejects a hello with a non-integer serverTime', () => {
    expect(
      PortfolioWsServerMessageSchema.safeParse({ type: 'hello', accountId: 'a1', serverTime: 1.5 })
        .success,
    ).toBe(false);
  });
});
