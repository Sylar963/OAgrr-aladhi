import { price76, type PositionLeg } from '@oggregator/core';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { AssistantMcpHandler, buildAssistantMcpTools } from './assistant-mcp-server.js';
import { AssistantMarketDataReader } from './market-data-reader.js';
import { OptionsLibrary } from './options-library.js';
import { PortfolioRefStore } from './portfolio-ref.js';
import { STRUCTURE_SEARCH_MAX_EXPIRIES } from './structure-search-tool.js';
import type { HeldLegsWithMarks } from './structure-tool-support.js';
import { ToolErrorPayloadSchema } from './tool-errors.js';

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
  for (let strike = 61_000; strike <= 109_000; strike += 2_000) {
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
      expect(reply.result.isError).toBeUndefined();
      const text = reply.result.content[0]?.text ?? '';
      const error = ToolErrorPayloadSchema.safeParse(JSON.parse(text));
      return error.success ? { error: error.data.error, code: error.data.code } : { data: JSON.parse(text) };
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
  components: Array<{ role: 'repair' | 'view'; label: string }>;
  legs: Leg[];
  worstLossUsd: number | null;
  fits: boolean;
  shortfallUsd: number | null;
  rewardToRisk: number;
  sameVenue: boolean;
}

describe('oggregator_structure_search', { timeout: 30_000 }, () => {
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
      expect.objectContaining({ role: 'repair', side: 'buy', size: 1, expiry: '2026-10-30', right: 'call', venue: 'deribit', feeSource: 'quote' }),
    ]);
    expect(cover?.legs[0]?.strike).toBeGreaterThan(85_000);
    expect(candidates.some((candidate) => candidate.family === 'buy_back_short')).toBe(true);
    expect(candidates.every((candidate) => candidate.fits && (candidate.worstLossUsd as number) >= -5_000)).toBe(true);
    expect(data.notes.some((note: string) => note.includes('oggregator_evaluate_structure'))).toBe(true);
  });

  it('returns repair + view packages, the repair alone and the exact gap for the $18 reference budget', async () => {
    const { ref, call, paths } = harness();
    const startedAt = performance.now();
    const { data } = await call({ portfolioRef: ref, underlying: 'BTC', view: 'bearish', maxTotalRiskUsd: 18, size: 0.1 });
    // Typical search on this chain: five expiries, 25 strikes each, every package evaluated book-wide.
    expect(performance.now() - startedAt).toBeLessThan(5_000);

    // The Oct 16 long is read for its closing quote even though only the Oct 30 short is uncovered.
    expect(paths.some((path) => path.includes('expiry=2026-10-16'))).toBe(true);
    expect(data.rankedBy).toBe('book_reward_to_risk');
    expect(data.candidates).toEqual([]);
    expect(data.repair).toMatchObject({
      reason: 'unbounded',
      chosen: 'Close book: sell 2026-10-16 87000 call, buy 2026-10-30 85000 call',
    });
    expect(data.repair.considered.map((option: { kind: string }) => option.kind)).toEqual(['close_book', 'buy_back', 'cover']);
    const repairOnly = data.repairOnly;
    expect(repairOnly).toMatchObject({ kind: 'close_book', fits: false });
    expect(repairOnly.legs.every((leg: Leg) => leg.role === 'repair')).toBe(true);
    expect(repairOnly.shortfallUsd).toBeCloseTo(-repairOnly.bookWorstLossUsd - 18, 1);
    const nearest = data.nearestInfeasible as Candidate[];
    expect(nearest.length).toBeGreaterThan(0);
    for (const candidate of nearest) {
      expect(candidate.components).toEqual([
        { role: 'repair', label: data.repair.chosen },
        { role: 'view', label: expect.stringMatching(/put/) },
      ]);
      expect(candidate.legs.filter((leg) => leg.role === 'view').every((leg) => leg.right === 'put' && leg.size === 0.1)).toBe(true);
      expect(candidate.shortfallUsd).toBeCloseTo(-(candidate.worstLossUsd as number) - 18, 1);
      expect(candidate.shortfallUsd as number).toBeGreaterThanOrEqual(repairOnly.shortfallUsd);
    }
    expect(data.notes.some((note: string) => note.startsWith('Even the repair alone exceeds the $18 budget by $'))).toBe(true);
  });

  it('returns fitting packages labelled repair and view when the budget allows', async () => {
    const { ref, call } = harness();
    const { data } = await call({ portfolioRef: ref, underlying: 'BTC', view: 'bearish', maxTotalRiskUsd: 3_000, limit: 3 });

    expect(data.repairOnly).toBeNull();
    const candidates = data.candidates as Candidate[];
    expect(candidates).toHaveLength(3);
    for (const candidate of candidates) {
      expect(candidate.components.map((component) => component.role)).toEqual(['repair', 'view']);
      expect(candidate.fits).toBe(true);
      expect(candidate.worstLossUsd as number).toBeGreaterThanOrEqual(-3_000);
    }
  });

  it('searches the proposed legs alone when the ref does not resolve and says the numbers are not book-wide', async () => {
    const { call, resolveHeldLegs } = harness();
    const { data } = await call({ portfolioRef: 'pref_unknown', underlying: 'BTC', view: 'bearish', maxTotalRiskUsd: 1_500 });

    expect(resolveHeldLegs).not.toHaveBeenCalled();
    expect(data.heldBook).toMatchObject({ included: false, status: 'unresolved', reason: 'unknown_ref' });
    expect(data.repair).toBeNull();
    expect((data.candidates as Candidate[]).length).toBeGreaterThan(0);
    expect(data.notes[0]).toMatch(/^HELD BOOK NOT INCLUDED/);
  });

  it('ranks structure-only bearish candidates by reward to risk within the budget', async () => {
    const { call, resolveHeldLegs, paths } = harness();
    const { data } = await call({ underlying: 'BTC', view: 'bearish', maxTotalRiskUsd: 1_500, minDte: 5, maxDte: 30 });

    expect(resolveHeldLegs).not.toHaveBeenCalled();
    expect(data.heldBook).toEqual({ included: false, status: 'not_requested', legCount: 0 });
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

  it('rejects a hedge search without a usable ref and malformed input with codes', async () => {
    const { call } = harness();
    expect(await call({ underlying: 'BTC', view: 'hedge_held_shorts', maxTotalRiskUsd: 100 })).toMatchObject({
      code: 'portfolio_ref_required',
      error: expect.stringContaining('needs the portfolioRef'),
    });
    expect(
      await call({ portfolioRef: 'pref_unknown', underlying: 'BTC', view: 'hedge_held_shorts', maxTotalRiskUsd: 100 }),
    ).toMatchObject({ code: 'portfolio_ref_unresolved', error: expect.stringContaining('not recognised') });
    expect((await call({ underlying: 'BTC', view: 'bearish', maxTotalRiskUsd: 0 })).error).toContain('Invalid arguments');
    expect((await call({ underlying: 'BTC', view: 'bearish', maxTotalRiskUsd: 10, limit: 9 })).error).toContain(
      'Invalid arguments',
    );
    expect(
      (await call({ underlying: 'BTC', view: 'bearish', maxTotalRiskUsd: 10, minDte: 10, maxDte: 5 })).error,
    ).toContain('maxDte must be at least minDte');
    expect(await call({ underlying: 'BTC', view: 'bearish', maxTotalRiskUsd: 10, minDte: 200, maxDte: 300 })).toMatchObject({
      code: 'not_found',
    });
  });
});
