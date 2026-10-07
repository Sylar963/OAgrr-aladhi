import { price76, type PositionLeg } from '@oggregator/core';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { AssistantMcpHandler, buildAssistantMcpTools } from './assistant-mcp-server.js';
import type { HeldLegsWithMarks } from './structure-tool-support.js';
import { AssistantMarketDataReader } from './market-data-reader.js';
import { OptionsLibrary } from './options-library.js';
import { PORTFOLIO_REF_TTL_MS, PortfolioRefStore } from './portfolio-ref.js';

const NOW = Date.parse('2026-10-07T12:00:00.000Z');
const SPOT = 84_000;
const IV = 0.5;

function held(legId: string, expiry: string, strike: number, size: number, entryPriceUsd: number) {
  const leg: PositionLeg = {
    legId,
    underlying: 'BTC',
    expiry,
    strike,
    optionRight: 'call',
    size,
    entryPriceUsd,
    entryIv: IV,
    entryTs: NOW,
    venueHint: 'deribit',
    source: 'thalex',
    realizedPnlUsd: 0,
  };
  return {
    leg,
    mark: {
      underlyingPriceUsd: SPOT,
      forwardPriceUsd: SPOT,
      markPriceUsd: 1_000,
      iv: IV,
      delta: null,
      gamma: null,
      vega: null,
      theta: null,
      yearsToExpiry: null,
    },
  };
}

const REFERENCE_BOOK: HeldLegsWithMarks = [
  held('long-oct16', '2026-10-16', 87_000, 1, 1_050),
  held('short-oct30', '2026-10-30', 85_000, -1, 3_031.95),
];

function venueQuote(
  bid: number | null,
  ask: number | null,
  fees: { bid: number; ask: number } | null = null,
) {
  return {
    bid,
    ask,
    mid: bid != null && ask != null ? (bid + ask) / 2 : null,
    bidSize: 2,
    askSize: 0.5,
    markIv: IV,
    asOfMs: NOW - 1_000,
    underlyingPriceUsd: SPOT,
    execution: fees == null ? null : { bidTakerFeeUsd: fees.bid, askTakerFeeUsd: fees.ask },
  };
}

const OCT30_CHAIN = {
  underlying: 'BTC',
  expiry: '2026-10-30',
  expiryTs: Date.parse('2026-10-30T08:00:00.000Z'),
  dte: 22.8,
  stats: { forwardPriceUsd: SPOT, indexPriceUsd: SPOT },
  strikes: [
    {
      strike: 85_000,
      call: {
        venues: {
          deribit: venueQuote(3_000, 3_100, { bid: 25, ask: 25 }),
          okx: venueQuote(2_990, 3_090),
        },
      },
      put: { venues: {} },
    },
    {
      strike: 90_000,
      call: {
        venues: {
          deribit: venueQuote(900, 1_000, { bid: 3, ask: 3 }),
          okx: venueQuote(920, 1_010, { bid: 4, ask: 4 }),
        },
      },
      put: { venues: {} },
    },
    {
      strike: 95_000,
      call: { venues: { deribit: venueQuote(400, null, { bid: 2, ask: 2 }) } },
      put: { venues: {} },
    },
  ],
};

function harness(book: HeldLegsWithMarks = REFERENCE_BOOK) {
  let now = NOW;
  const reader = new AssistantMarketDataReader(() => now);
  reader.bind(async (path) =>
    path.includes('expiry=2026-10-30')
      ? { statusCode: 200, body: OCT30_CHAIN }
      : { statusCode: 404, body: { message: 'expiry not listed' } },
  );
  const refs = new PortfolioRefStore({ now: () => now });
  const resolveHeldLegs = vi.fn(async () => book);
  const handler = new AssistantMcpHandler(
    buildAssistantMcpTools(
      reader,
      new OptionsLibrary('/tmp/oggregator-nonexistent-test-library.sqlite'),
      { refs, resolveHeldLegs },
      () => now,
    ),
    Fastify({ logger: false }).log,
  );
  const ref = refs.mint({ accountId: 'user-1', source: 'thalex', underlying: 'BTC', generatedAt: NOW });
  return {
    ref,
    refs,
    resolveHeldLegs,
    advance: (ms: number) => {
      now += ms;
    },
    call: async (args: Record<string, unknown>) => {
      const reply = (await handler.handle({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'oggregator_evaluate_structure', arguments: args },
      })) as { result: { content: Array<{ text: string }>; isError?: boolean } };
      const text = reply.result.content[0]?.text ?? '';
      return reply.result.isError ? { error: text } : { data: JSON.parse(text) };
    },
  };
}

const BUY_90K = { expiry: '2026-10-30', strike: 90_000, right: 'call', side: 'buy', size: 1 };

describe('oggregator_evaluate_structure', () => {
  it('caps the referenced book with a higher-strike Oct 30 call at the best ask', async () => {
    const { ref, call, resolveHeldLegs } = harness();
    const { data } = await call({ portfolioRef: ref, underlying: 'btc', legs: [BUY_90K], riskBudgetUsd: 2_000 });

    expect(resolveHeldLegs).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'user-1', source: 'thalex' }));
    expect(data.status).toBe('ok');
    expect(data.heldBook).toEqual({ included: true, legCount: 2, portfolioGeneratedAt: '2026-10-07T12:00:00.000Z' });
    expect(data.legs[0]).toMatchObject({
      venue: 'deribit',
      executablePriceUsd: 1_000,
      midUsd: 950,
      premiumUsd: 1_000,
      feeUsd: 3,
      feeSource: 'quote',
      quote: { venue: 'deribit', bidUsd: 900, askUsd: 1_000, asOf: '2026-10-07T11:59:59.000Z', quotingVenues: 2 },
      error: null,
    });
    expect(data.heldOnly.upsideUnbounded).toBe(true);
    expect(data.combined.upsideUnbounded).toBe(false);

    const windowOne =
      -1_050 + 3_031.95 - price76(87_000, 85_000, IV, 14 / 365, 'call') + price76(87_000, 90_000, IV, 14 / 365, 'call') - 1_000;
    const windowTwo = -2_000 - 1_050 + 3_031.95 - 1_000;
    const expected = Math.min(windowOne, windowTwo) - 3;
    expect(Math.abs(data.combined.worstLossUsd - expected)).toBeLessThanOrEqual(0.01);
    expect(data.incrementalBasis).toBe('held_unbounded');
    expect(data.incrementalWorstLossUsd).toBeNull();
    expect(data.budget).toMatchObject({ riskBudgetUsd: 2_000, fits: true });
    expect(data.horizonScenarios.horizonsDays).toEqual([0, 1, 3, 7, 8.83, 14, 22.83, 30]);
    expect(data.payoffAtExpiries.map((row: { expiry: string }) => row.expiry)).toEqual(['2026-10-16', '2026-10-30']);
    expect(data.assumptions.length).toBeGreaterThan(0);
    expect(data.notes.some((note: string) => note.includes('displayed size 0.5'))).toBe(true);
  });

  it('removes the unbounded flag when the short is bought back, and an $18 budget does not fit', async () => {
    const { ref, call } = harness();
    const { data } = await call({
      portfolioRef: ref,
      underlying: 'BTC',
      legs: [{ expiry: '2026-10-30', strike: 85_000, right: 'call', side: 'buy', size: 1 }],
      riskBudgetUsd: 18,
    });

    // OKX gives no fee estimate: 0.05% of the 84,000 underlying (42) is below 12.5% of the 3,090 ask.
    expect(data.legs[0]).toMatchObject({
      venue: 'okx',
      executablePriceUsd: 3_090,
      feeSource: 'default_estimate',
      feeUsd: 42,
    });
    expect(data.combined.upsideUnbounded).toBe(false);
    expect(data.combined.worstLossUsd).toBeCloseTo(-1_050 - (3_090 - 3_031.95) - 42, 2);
    expect(data.budget).toMatchObject({ fits: false });
    expect(data.notes.some((note: string) => note.includes('no venue fee estimate'))).toBe(true);
  });

  it('sells at the bid on the requested venue and evaluates proposed legs alone without a ref', async () => {
    const { call, resolveHeldLegs } = harness();
    const { data } = await call({
      underlying: 'BTC',
      legs: [
        { ...BUY_90K, venue: 'okx' },
        { expiry: '2026-10-30', strike: 95_000, right: 'call', side: 'sell', size: 1, priceUsd: 5_000 },
      ],
    });

    expect(resolveHeldLegs).not.toHaveBeenCalled();
    expect(data.heldBook).toEqual({ included: false, legCount: 0 });
    expect(data.heldOnly).toBeNull();
    expect(data.legs[0]).toMatchObject({ venue: 'okx', executablePriceUsd: 1_010, feeUsd: 4 });
    expect(data.legs[1]).toMatchObject({ venue: 'deribit', executablePriceUsd: 400, premiumUsd: -400, feeUsd: 2 });
    expect(data.totals).toMatchObject({ netPremiumUsd: 610, feesUsd: 6, netCostUsd: 616 });
    expect(data.combined.worstLossUsd).toBeCloseTo(-616, 2);
  });

  it('reports missing quotes per leg instead of pricing them', async () => {
    const { ref, call } = harness();
    const { data } = await call({
      portfolioRef: ref,
      underlying: 'BTC',
      legs: [
        BUY_90K,
        { expiry: '2026-10-30', strike: 95_000, right: 'call', side: 'buy', size: 1 },
        { expiry: '2026-10-30', strike: 100_000, right: 'call', side: 'buy', size: 1 },
        { expiry: '2026-10-23', strike: 90_000, right: 'call', side: 'buy', size: 1 },
      ],
    });

    expect(data.status).toBe('quote_error');
    expect(data.combined).toBeUndefined();
    expect(data.legs.map((leg: { error: string | null }) => leg.error)).toEqual([
      null,
      'No executable ask for BTC 2026-10-30 95000 call.',
      'No fresh quote for BTC 2026-10-30 100000 call. Check the strike with oggregator_option_chain.',
      expect.stringContaining('Chain unavailable for BTC 2026-10-23'),
    ]);
    expect(data.legs[1].executablePriceUsd).toBeNull();
  });

  it('rejects unknown, tampered, expired and mismatched refs', async () => {
    const { ref, refs, call, advance, resolveHeldLegs } = harness();
    const tampered = `${ref.slice(0, -2)}${ref.endsWith('AA') ? 'BB' : 'AA'}`;

    expect((await call({ portfolioRef: tampered, underlying: 'BTC', legs: [BUY_90K] })).error).toContain(
      'not recognised',
    );
    expect((await call({ portfolioRef: 'user-1', underlying: 'BTC', legs: [BUY_90K] })).error).toContain(
      'not recognised',
    );
    const ethRef = refs.mint({ accountId: 'user-1', source: 'thalex', underlying: 'ETH', generatedAt: NOW });
    expect((await call({ portfolioRef: ethRef, underlying: 'BTC', legs: [BUY_90K] })).error).toBe(
      'portfolioRef covers the ETH book, not BTC.',
    );
    advance(PORTFOLIO_REF_TTL_MS);
    expect((await call({ portfolioRef: ref, underlying: 'BTC', legs: [BUY_90K] })).error).toContain('expired');
    expect(resolveHeldLegs).not.toHaveBeenCalled();
  });

  it('rejects malformed leg input', async () => {
    const { call } = harness();
    expect((await call({ underlying: 'BTC', legs: [] })).error).toContain('Invalid arguments');
    expect((await call({ underlying: 'BTC', legs: [{ ...BUY_90K, size: 0 }] })).error).toContain('Invalid arguments');
    expect((await call({ underlying: 'BTC', legs: [{ ...BUY_90K, venue: 'nyse' }] })).error).toContain(
      'Invalid arguments',
    );
  });
});
