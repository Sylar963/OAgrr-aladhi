import { describe, expect, it } from 'vitest';
import type { Leg } from '@features/architect/payoff';
import { legsToOrderRequest } from './order-mapper';

function leg(overrides: Partial<Leg> = {}): Leg {
  return {
    id: 'leg-1',
    type: 'call',
    direction: 'buy',
    strike: 70_000,
    expiry: '2026-06-26',
    quantity: 0.05,
    entryPrice: 4_200,
    venue: 'okx',
    delta: null,
    gamma: null,
    theta: null,
    vega: null,
    iv: null,
    ...overrides,
  };
}

describe('legsToOrderRequest', () => {
  it('labels quantity as base exposure without pinning an automatic display venue', () => {
    const request = legsToOrderRequest([leg()], 'BTC', []);

    expect(request.legs[0]).toMatchObject({
      quantity: 0.05,
      quantityUnit: 'base',
      preferredVenues: null,
    });
  });

  it('lets explicit strategy routing override the selected venue', () => {
    const request = legsToOrderRequest([leg()], 'BTC', [], {
      legs: { 'leg-1': { venue: 'deribit', pickedSide: 'ask' } },
    });

    expect(request.legs[0]?.preferredVenues).toEqual(['deribit']);
  });
});
