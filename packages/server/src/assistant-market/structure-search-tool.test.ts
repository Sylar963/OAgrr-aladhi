import { price76, type PositionLeg } from '@oggregator/core';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { AssistantMcpHandler, buildAssistantMcpTools } from './assistant-mcp-server.js';
import { AssistantMarketDataReader } from './market-data-reader.js';
import { OptionsLibrary } from './options-library.js';
import { PortfolioRefStore } from './portfolio-ref.js';
import { STRUCTURE_SEARCH_MAX_EXPIRIES } from './structure-search-tool.js';
import type { HeldLegsWithMarks } from './structure-tool-support.js';

const NOW = Date.parse('2026-10-07T12:00:00.000Z');
const SPOT = 84_000;
const IV = 0.5;
const DAY_MS = 86_400_000;

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

// Deribit quotes ±2% around Black-76 with a 10 USD taker fee; OKX quotes ±3% with no fee estimate.
function chainBody(expiry: string) {
  const expiryTs = Date.parse(`${expiry}T08:00:00.000Z`);
  const years = (expiryTs - NOW) / (365 * DAY_MS);
  const quote = (fair: number, halfSpread: number, fee: number | null) => ({
    bid: fair * (1 - halfSpread),
    ask: fair * (1 + halfSpread),
    mid: fair,
    bidSize: 3,
    askSize: 3,
    markIv: IV,
    asOfMs: NOW - 1_000,
    underlyingPriceUsd: SPOT,
    execution: fee == null ? null : { bidTakerFeeUsd: fee, askTakerFeeUsd: fee },
  });
  const strikes = [];
  for (let strike = 60_000; strike <= 110_000; strike += 1_000) {
    const side = (right: 'call' | 'put') => {
      const fair = price76(SPOT, strike, IV, years, right);
      return fair < 5 ? { venues: {} } : { venues: { deribit: quote(fair, 0.02, 10), okx: quote(fair, 0.03, null) } };
    };
    strikes.push({ strike, call: side('call'), put: side('put') });
  }
  return {
    underlying: 'BTC',
    expiry,
    expiryTs,
    dte: (expiryTs - NOW) / DAY_MS,
    stats: { forwardPriceUsd: SPOT, indexPriceUsd: SPOT },
    strikes,
  };
}

function harness(options: { expiries?: string[]; failing?: string[] } = {}) {
  const expiries = options.expiries ?? ['2026-10-08', '2026-10-16', '2026-10-23', '2026-10-30', '2026-12-25'];
  const reader = new AssistantMarketDataReader(() => NOW);
  const paths: string[] = [];
  reader.bind(async (path) => {
    paths.push(path);
    if (path.startsWith('/api/expiries')) {
      return { statusCode: 200, body: { underlying: 'BTC', expiries } };
    }
    const expiry = /expiry=([\d-]+)/.exec(path)?.[1] ?? '';
    if (options.failing?.includes(expiry) || !expiries.includes(expiry)) {
      return { statusCode: 404, body: { message: 'expiry not listed' } };
    }
    return { statusCode: 200, body: chainBody(expiry) };
  });
  const refs = new PortfolioRefStore({ now: () => NOW });
  const resolveHeldLegs = vi.fn(async () => REFERENCE_BOOK);
  const handler = new AssistantMcpHandler(
    buildAssistantMcpTools(
      reader,
      new OptionsLibrary('/tmp/oggregator-nonexistent-test-library.sqlite'),
      { refs, resolveHeldLegs },
      () => NOW,
    ),
    Fastify({ logger: false }).log,
  );
  const ref = refs.mint({ accountId: 'user-1', source: 'thalex', underlying: 'BTC', generatedAt: NOW });
  return {
    ref,
    paths,
    resolveHeldLegs,
    call: async (args: Record<string, unknown>) => {
      const reply = (await handler.handle({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'oggregator_structure_search', arguments: args },
      })) as { result: { content: Array<{ text: string }>; isError?: boolean } };
      const text = reply.result.content[0]?.text ?? '';
      return reply.result.isError ? { error: text } : { data: JSON.parse(text) };
    },
  };
}

interface Leg {
  role: string;
  side: string;
  size: number;
  expiry: string;
  strike: number;
  right: string;
  venue: string;
  priceUsd: number;
  feeSource: string;
}

interface Candidate {
  label: string;
  family: string;
  legs: Leg[];
  worstLossUsd: number | null;
  fits: boolean;
  shortfallUsd: number | null;
  rewardToRisk: number;
  sameVenue: boolean;
}

describe('oggregator_structure_search', () => {
  it('finds the Oct 30 higher-strike cover for the referenced book', async () => {
    const { ref, call, resolveHeldLegs } = harness();
    const { data } = await call({ portfolioRef: ref, underlying: 'btc', view: 'hedge_held_shorts', maxTotalRiskUsd: 5_000, limit: 8 });

    expect(resolveHeldLegs).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'user-1' }));
    expect(data.status).toBe('ok');
    expect(data.searched.expiries).toEqual(['2026-10-30']);
    expect(data.heldBook).toMatchObject({
      included: true,
      legCount: 2,
      worstLossUsd: null,
      upsideUnbounded: true,
      uncoveredShorts: ['short 1 BTC 2026-10-30 85000 call (upside_unbounded)'],
    });
    const candidates = data.candidates as Candidate[];
    const cover = candidates.find((candidate) => candidate.family === 'cover_short');
    expect(cover?.legs).toEqual([
      expect.objectContaining({ role: 'cover', side: 'buy', size: 1, expiry: '2026-10-30', right: 'call', venue: 'deribit', feeSource: 'quote' }),
    ]);
    expect(cover?.legs[0]?.strike).toBeGreaterThan(85_000);
    expect(candidates.some((candidate) => candidate.family === 'buy_back_short')).toBe(true);
    expect(candidates.every((candidate) => candidate.fits && (candidate.worstLossUsd as number) >= -5_000)).toBe(true);
    expect(data.notes.some((note: string) => note.includes('oggregator_evaluate_structure'))).toBe(true);
  });

  it('returns the closest bearish candidates and the shortfall for the $18 reference budget', async () => {
    const { ref, call } = harness();
    const { data } = await call({ portfolioRef: ref, underlying: 'BTC', view: 'bearish', maxTotalRiskUsd: 18, size: 0.1 });

    expect(data.candidates).toEqual([]);
    expect(data.cover).toMatchObject({ label: 'Buy back 2026-10-30 85000 call' });
    expect(data.cover.bookWorstLossUsd).toBeLessThan(-18);
    const nearest = data.nearestInfeasible as Candidate[];
    expect(nearest.length).toBeGreaterThan(0);
    for (const candidate of nearest) {
      expect(candidate.label.startsWith('Buy back 2026-10-30 85000 call + ')).toBe(true);
      expect(candidate.legs[0]).toMatchObject({ role: 'cover', size: 1 });
      expect(candidate.legs.slice(1).every((leg) => leg.right === 'put' && leg.size === 0.1)).toBe(true);
      expect(candidate.shortfallUsd).toBeCloseTo(-(candidate.worstLossUsd as number) - 18, 1);
    }
    expect(data.notes.some((note: string) => note.includes('Nothing fits the $18 budget'))).toBe(true);
  });

  it('ranks structure-only bearish candidates by reward to risk within the budget', async () => {
    const { call, resolveHeldLegs, paths } = harness();
    const { data } = await call({ underlying: 'BTC', view: 'bearish', maxTotalRiskUsd: 1_500, minDte: 5, maxDte: 30 });

    expect(resolveHeldLegs).not.toHaveBeenCalled();
    expect(data.heldBook).toEqual({ included: false, legCount: 0 });
    expect(data.searched.expiries).toEqual(['2026-10-16', '2026-10-23', '2026-10-30']);
    expect(paths.filter((path) => path.startsWith('/api/chains'))).toHaveLength(3);
    const candidates = data.candidates as Candidate[];
    expect(candidates).toHaveLength(5);
    const ratios = candidates.map((candidate) => candidate.rewardToRisk);
    expect(ratios).toEqual([...ratios].sort((left, right) => right - left));
    for (const candidate of candidates) {
      expect(candidate.fits).toBe(true);
      expect(candidate.worstLossUsd as number).toBeGreaterThanOrEqual(-1_500);
      const buy = candidate.legs.find((leg) => leg.side === 'buy');
      expect(buy?.venue).toBe('deribit');
    }
    expect(data.nearestInfeasible).toEqual([]);
  });

  it('prices on the requested venue with a conservative default fee', async () => {
    const { call } = harness();
    const { data } = await call({ underlying: 'BTC', view: 'long_vol', maxTotalRiskUsd: 50_000, venues: ['okx'], limit: 3 });

    const candidates = data.candidates as Candidate[];
    expect(candidates).toHaveLength(3);
    for (const candidate of candidates) {
      expect(candidate.sameVenue).toBe(true);
      expect(candidate.legs.every((leg) => leg.venue === 'okx' && leg.feeSource === 'default_estimate')).toBe(true);
    }
    expect(data.notes.some((note: string) => note.includes('default_estimate'))).toBe(true);
  });

  it('caps the expiries searched and reports chains that fail', async () => {
    const expiries = Array.from({ length: 9 }, (_, index) =>
      new Date(NOW + (index + 2) * 3 * DAY_MS).toISOString().slice(0, 10),
    );
    const { call } = harness({ expiries, failing: [expiries[1] as string] });
    const { data } = await call({ underlying: 'BTC', view: 'bullish', maxTotalRiskUsd: 3_000 });

    expect(data.searched.expiries).toHaveLength(STRUCTURE_SEARCH_MAX_EXPIRIES);
    expect(data.notes.some((note: string) => note.includes('3 later expiries'))).toBe(true);
    expect(data.notes.some((note: string) => note.startsWith(`Chain unavailable for BTC ${expiries[1]}`))).toBe(true);
    expect((data.candidates as Candidate[]).every((candidate) => candidate.legs[0]?.right === 'call')).toBe(true);
  });

  it('rejects a hedge search without a ref and malformed input', async () => {
    const { call } = harness();
    expect((await call({ underlying: 'BTC', view: 'hedge_held_shorts', maxTotalRiskUsd: 100 })).error).toContain(
      'needs the portfolioRef',
    );
    expect((await call({ underlying: 'BTC', view: 'bearish', maxTotalRiskUsd: 0 })).error).toContain('Invalid arguments');
    expect((await call({ underlying: 'BTC', view: 'bearish', maxTotalRiskUsd: 10, limit: 9 })).error).toContain(
      'Invalid arguments',
    );
    expect(
      (await call({ underlying: 'BTC', view: 'bearish', maxTotalRiskUsd: 10, minDte: 10, maxDte: 5 })).error,
    ).toContain('maxDte must be at least minDte');
    expect((await call({ portfolioRef: 'pref_unknown', underlying: 'BTC', view: 'bearish', maxTotalRiskUsd: 10 })).error).toContain(
      'not recognised',
    );
  });
});
