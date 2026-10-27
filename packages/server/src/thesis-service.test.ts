import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ThesisCandle, ThesisLegWithMark } from '@oggregator/core';
import {
  NoopThesisStore,
  type PersistedThesis,
  type PersistedThesisEvent,
  type ThesisStore,
} from '@oggregator/db';
import {
  THESIS_FLIP_CONFIRMATION,
  type PortfolioSource,
  type ThesisGateCheckRequest,
  type ThesisGateLeg,
} from '@oggregator/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type ThesisHeldBook, ThesisService } from './thesis-service.js';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const ACCOUNT = 'acct_test';
const silentLog = { warn: () => {}, info: () => {} };

interface Harness {
  service: ThesisService;
  clock: { now: number };
  market: { spot: number; candles: ThesisCandle[]; atmIv: number | null };
  books: Map<PortfolioSource, ThesisHeldBook>;
  bookListeners: Array<(accountId: string, source: PortfolioSource) => void>;
}

let dir: string;
const services: ThesisService[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'thesis-'));
});

afterEach(() => {
  for (const service of services.splice(0)) service.dispose();
  rmSync(dir, { recursive: true, force: true });
});

function harness(options: { store?: ThesisStore; clock?: { now: number } } = {}): Harness {
  const clock = options.clock ?? { now: Date.parse('2026-10-06T06:00:00Z') };
  const market = { spot: 84_000, candles: [] as ThesisCandle[], atmIv: 0.42 as number | null };
  const books = new Map<PortfolioSource, ThesisHeldBook>();
  const bookListeners: Harness['bookListeners'] = [];
  const service = new ThesisService({
    store: options.store ?? new NoopThesisStore(),
    cachePath: join(dir, 'theses.ndjson'),
    flushIntervalMs: DAY_MS,
    evaluateIntervalMs: 60 * 60_000,
    bookSources: ['thalex', 'manual'],
    log: silentLog,
    now: () => clock.now,
    market: {
      spotUsd: () => market.spot,
      candles: async () => market.candles,
      chainStats: async () => ({ atmIv: market.atmIv, skew25d: -0.02 }),
      dvol: () => 0.44,
      netGexUsdMillions: async () => 10,
    },
    book: {
      heldBook: async (_accountId, source) => books.get(source) ?? { live: true, legs: [] },
      subscribe: (listener) => {
        bookListeners.push(listener);
        return () => {};
      },
    },
  });
  services.push(service);
  return { service, clock, market, books, bookListeners };
}

const bearishThesis = {
  underlying: 'BTC',
  direction: 'bearish' as const,
  horizonExpiry: '2026-10-23',
  level: 85_105,
  confirmSec: 86400 as const,
  reason: 'Rally into resistance failed, funding hot, expect 80k before 23 OCT.',
};

const callSpread: ThesisGateLeg[] = [
  { expiry: '2026-10-23', strike: 83_000, optionRight: 'call', side: 'buy', size: 1, premiumUsd: 1_500, iv: 0.42 },
  { expiry: '2026-10-23', strike: 86_000, optionRight: 'call', side: 'sell', size: 1, premiumUsd: 500, iv: 0.42 },
];
const gateRequest = (legs: ThesisGateLeg[] = callSpread): ThesisGateCheckRequest => ({ underlying: 'BTC', legs });

function heldLeg(strike: number, optionRight: 'call' | 'put', size: number, mark: number): ThesisLegWithMark {
  return {
    leg: {
      legId: `${strike}${optionRight}${size}`,
      underlying: 'BTC',
      expiry: '2026-10-23',
      strike,
      optionRight,
      size,
      entryPriceUsd: mark,
      entryIv: 0.42,
      realizedPnlUsd: 0,
      entryTs: 0,
      venueHint: 'thalex',
      source: 'thalex',
    },
    mark: {
      underlyingPriceUsd: 83_000,
      forwardPriceUsd: 83_000,
      markPriceUsd: mark,
      iv: 0.42,
      delta: null,
      gamma: null,
      vega: null,
      theta: null,
      yearsToExpiry: null,
    },
  };
}

async function eventKinds(service: ThesisService, store: RecordingStore): Promise<string[]> {
  await service.flush();
  return store.events.map((event) => event.kind);
}

class RecordingStore implements ThesisStore {
  readonly enabled = true;
  theses = new Map<string, PersistedThesis>();
  events: PersistedThesisEvent[] = [];
  async load() {
    return { theses: [...this.theses.values()], events: [...this.events] };
  }
  async save(theses: PersistedThesis[], events: PersistedThesisEvent[]) {
    for (const thesis of theses) this.theses.set(thesis.id, thesis);
    this.events.push(...events);
    return { theses: theses.length, events: events.length };
  }
  async dispose() {}
}

describe('ThesisService', () => {
  it('gates the 2026-10-17 flip against an intact bearish thesis and shows nothing changed', async () => {
    const store = new RecordingStore();
    const { service, clock, market } = harness({ store });
    const created = await service.create(ACCOUNT, bearishThesis);
    expect(created.thesis.contextAtCreation).toMatchObject({ spotUsd: 84_000, dvol: 0.44, atmIv: 0.42 });

    clock.now = Date.parse('2026-10-17T12:00:00Z');
    market.spot = 83_050;
    market.candles = [{ timestamp: Date.parse('2026-10-16T00:00:00Z'), close: 81_628 }];
    const result = await service.gateCheck(ACCOUNT, gateRequest());
    expect(result.decision).toBe('gate');
    expect(result.reason).toBe('opposite');
    expect(result.proposed.classification).toBe('bullish');
    expect(result.view?.status.status).toBe('INTACT');
    expect(result.view?.diff?.materialCount).toBe(0);
    expect(result.heldBookNote).toContain('judged on the structure alone');

    await service.gateCheck(ACCOUNT, gateRequest());
    expect((await eventKinds(service, store)).filter((kind) => kind === 'gate_shown')).toHaveLength(1);
  });

  it('passes a same-direction structure and reports unknown when nothing can be valued', async () => {
    const { service, market } = harness();
    await service.create(ACCOUNT, bearishThesis);
    const put: ThesisGateLeg[] = [
      { expiry: '2026-10-23', strike: 83_000, optionRight: 'put', side: 'buy', size: 1, premiumUsd: 1_200, iv: 0.42 },
    ];
    expect((await service.gateCheck(ACCOUNT, gateRequest(put))).decision).toBe('pass');

    market.atmIv = null;
    const noIv = callSpread.map((leg) => ({ ...leg, iv: null }));
    const unknown = await service.gateCheck(ACCOUNT, gateRequest(noIv));
    expect(unknown.decision).toBe('unknown');
  });

  it('passes a short straddle that loses on both sides as short vol, not bullish', async () => {
    const { service, market } = harness();
    await service.create(ACCOUNT, bearishThesis);
    const strike = Math.round(market.spot / 1_000) * 1_000 + 1_000;
    const straddle: ThesisGateLeg[] = (['call', 'put'] as const).map((optionRight) => ({
      expiry: '2026-10-23',
      strike,
      optionRight,
      side: 'sell',
      size: 1,
      premiumUsd: 1_400,
      iv: 0.42,
    }));
    const result = await service.gateCheck(ACCOUNT, gateRequest(straddle));
    expect(result.proposed).toMatchObject({ classification: 'neutral', shape: 'short_vol' });
    expect(result.proposed.upPnlUsd!).toBeLessThan(0);
    expect(result.proposed.downPnlUsd!).toBeLessThan(0);
    expect(result).toMatchObject({ decision: 'pass', reason: 'neutral' });
  });

  it('combines the live held book: a small hedge on a bearish book passes, a flat-out flip gates', async () => {
    const { service, books } = harness();
    await service.create(ACCOUNT, bearishThesis);
    books.set('thalex', { live: true, legs: [heldLeg(83_000, 'put', 3, 1_400)] });
    const small: ThesisGateLeg[] = [
      { expiry: '2026-10-23', strike: 85_000, optionRight: 'call', side: 'buy', size: 0.5, premiumUsd: 700, iv: 0.42 },
    ];
    const hedged = await service.gateCheck(ACCOUNT, gateRequest(small));
    expect(hedged.held?.classification).toBe('bearish');
    expect(hedged.combined?.classification).toBe('bearish');
    expect(hedged.decision).toBe('pass');
    expect(hedged.heldBookNote).toContain('thalex');

    const big: ThesisGateLeg[] = [
      { expiry: '2026-10-23', strike: 83_000, optionRight: 'call', side: 'buy', size: 8, premiumUsd: 1_500, iv: 0.42 },
    ];
    const flipped = await service.gateCheck(ACCOUNT, gateRequest(big));
    expect(flipped.combined).toMatchObject({ classification: 'bullish', shape: 'long_vol', lean: 'bullish' });
    expect(flipped.decision).toBe('gate');

    books.set('thalex', { live: false, legs: [heldLeg(83_000, 'put', 3, 1_400)] });
    const notLive = await service.gateCheck(ACCOUNT, gateRequest(small));
    expect(notLive.combined).toBeNull();
    expect(notLive.decision).toBe('gate');
  });

  it('rejects a level on the wrong side of spot and a second active thesis', async () => {
    const { service } = harness();
    await expect(service.create(ACCOUNT, { ...bearishThesis, level: 83_000 })).rejects.toMatchObject({
      code: 'level_wrong_side',
    });
    await service.create(ACCOUNT, bearishThesis);
    await expect(service.create(ACCOUNT, bearishThesis)).rejects.toMatchObject({ code: 'active_exists' });
  });

  it('only tightens the level', async () => {
    const { service } = harness();
    const { thesis } = await service.create(ACCOUNT, bearishThesis);
    await expect(service.tighten(ACCOUNT, thesis.id, 86_000)).rejects.toMatchObject({ code: 'widen_rejected' });
    expect((await service.tighten(ACCOUNT, thesis.id, 84_800)).thesis.level).toBe(84_800);
  });

  it.each([
    { direction: 'bearish' as const, level: 85_105, tightened: 84_500, pastClose: 84_800 },
    { direction: 'bullish' as const, level: 80_000, tightened: 83_000, pastClose: 82_000 },
  ])('does not retroactively invalidate a tightened $direction thesis, including after restart', async (rule) => {
    const { service, clock, market } = harness();
    const { thesis } = await service.create(ACCOUNT, { ...bearishThesis, ...rule });
    clock.now += 2 * DAY_MS;
    market.candles = [{ timestamp: thesis.createdAt, close: rule.pastClose }];
    const updated = await service.tighten(ACCOUNT, thesis.id, rule.tightened);
    expect(updated.thesis.state).toBe('active');
    expect(updated.thesis.createdAt).toBe(thesis.createdAt);
    expect(updated.status.firedCandleTs).toBeNull();
    service.dispose();

    const restarted = harness({ clock });
    restarted.market.candles = market.candles;
    expect((await restarted.service.list(ACCOUNT)).active).toHaveLength(1);
    restarted.market.candles.push({ timestamp: clock.now, close: rule.pastClose });
    clock.now += DAY_MS;
    expect((await restarted.service.list(ACCOUNT)).active).toHaveLength(0);
  });

  it.each([
    { direction: 'bearish' as const, level: 85_105, tightened: 83_000 },
    { direction: 'bullish' as const, level: 80_000, tightened: 85_000 },
  ])('rejects tightening a $direction level through spot without changing the thesis', async (rule) => {
    const { service } = harness();
    const { thesis } = await service.create(ACCOUNT, { ...bearishThesis, ...rule });
    await expect(service.tighten(ACCOUNT, thesis.id, rule.tightened)).rejects.toMatchObject({ code: 'level_wrong_side' });
    expect((await service.list(ACCOUNT)).active[0]?.thesis.level).toBe(rule.level);
  });

  it('cannot erase an existing invalidation by tightening', async () => {
    const { service, clock, market } = harness();
    const { thesis } = await service.create(ACCOUNT, bearishThesis);
    clock.now += 2 * DAY_MS;
    market.candles = [{ timestamp: thesis.createdAt, close: 86_000 }];
    await expect(service.tighten(ACCOUNT, thesis.id, 84_500)).rejects.toMatchObject({ code: 'not_active' });
    expect((await service.list(ACCOUNT)).active).toHaveLength(0);
  });

  it('runs the reversal cooldown after an early end', async () => {
    const { service, clock } = harness();
    const { thesis } = await service.create(ACCOUNT, bearishThesis);
    await service.end(ACCOUNT, thesis.id, 'out flat');

    const blocked = await service.gateCheck(ACCOUNT, gateRequest());
    expect(blocked).toMatchObject({ decision: 'gate', reason: 'reversal_cooldown' });
    expect(blocked.view?.cooldown?.kind).toBe('reversal');

    const bullish = { ...bearishThesis, direction: 'bullish' as const, level: 81_000 };
    await expect(service.create(ACCOUNT, bullish)).rejects.toMatchObject({ code: 'reversal_cooldown' });

    clock.now += DAY_MS + 1;
    expect((await service.gateCheck(ACCOUNT, gateRequest())).decision).toBe('pass');
    expect((await service.create(ACCOUNT, bullish)).thesis.direction).toBe('bullish');
  });

  it('requires the typed confirmation to flip before a wait, and records an override', async () => {
    const store = new RecordingStore();
    const { service } = harness({ store });
    const { thesis } = await service.create(ACCOUNT, bearishThesis);
    const flip = {
      reason: 'Spot reclaimed 84k on rising volume and the funding reset; I no longer expect 80k.',
      newThesis: {
        direction: 'bullish' as const,
        horizonExpiry: '2026-10-30',
        level: 81_500,
        reason: 'Reclaim of 84k holds; wrong below 81.5k.',
      },
    };
    await expect(service.flip(ACCOUNT, thesis.id, flip)).rejects.toMatchObject({ code: 'confirmation_required' });
    const next = await service.flip(ACCOUNT, thesis.id, { ...flip, confirmation: THESIS_FLIP_CONFIRMATION });
    expect(next.thesis.direction).toBe('bullish');
    const list = await service.list(ACCOUNT);
    expect(list.active.map((view) => view.thesis.id)).toEqual([next.thesis.id]);
    await service.flush();
    expect(store.theses.get(thesis.id)?.state).toBe('overridden');
    expect(store.events.map((event) => event.kind)).toContain('override');
  });

  it('lets a flip through without the phrase once a 24h wait finished', async () => {
    const store = new RecordingStore();
    const { service, clock } = harness({ store });
    const { thesis } = await service.create(ACCOUNT, bearishThesis);
    const waiting = await service.wait(ACCOUNT, thesis.id);
    expect(waiting.cooldown).toMatchObject({ kind: 'wait', completed: false });
    await expect(service.wait(ACCOUNT, thesis.id)).rejects.toMatchObject({ code: 'wait_running' });

    clock.now += DAY_MS;
    await service.evaluate();
    const [view] = (await service.list(ACCOUNT)).active;
    expect(view?.waitCompleted).toBe(true);
    await service.flip(ACCOUNT, thesis.id, {
      reason: 'Still want to flip after a full day: the 84k reclaim held on two daily closes.',
      newThesis: { direction: 'bullish', horizonExpiry: '2026-10-30', level: 81_500, reason: 'Holding 84k; wrong below 81.5k.' },
    });
    await service.flush();
    expect(store.theses.get(thesis.id)?.state).toBe('reversed');
    expect(store.events.map((event) => event.kind)).toEqual(
      expect.arrayContaining(['cooldown_started', 'cooldown_ended', 'flip_after_wait']),
    );
  });

  it('ends the thesis when a confirmation candle closes beyond the level, then passes flips', async () => {
    const { service, clock, market } = harness();
    await service.create(ACCOUNT, bearishThesis);
    clock.now = Date.parse('2026-10-21T00:00:01Z');
    market.spot = 85_400;
    market.candles = [{ timestamp: Date.parse('2026-10-20T00:00:00Z'), close: 85_400 }];
    const result = await service.gateCheck(ACCOUNT, gateRequest());
    expect(result).toMatchObject({ decision: 'pass', reason: 'no_thesis' });
    expect((await service.list(ACCOUNT)).active).toHaveLength(0);
  });

  it('detects a held book that turned against the thesis and clears it when it returns', async () => {
    const { service, books } = harness();
    const { thesis } = await service.create(ACCOUNT, bearishThesis);
    books.set('thalex', { live: true, legs: [heldLeg(83_000, 'call', 2, 1_500)] });
    await service.checkHeldBook(ACCOUNT, 'thalex');
    let [view] = (await service.list(ACCOUNT)).active;
    expect(view?.pendingFlip).toMatchObject({ source: 'thalex', classification: 'bullish', backToThesis: false });

    await service.backToThesis(ACCOUNT, thesis.id);
    [view] = (await service.list(ACCOUNT)).active;
    expect(view?.pendingFlip?.backToThesis).toBe(true);

    books.set('thalex', { live: false, legs: [] });
    await service.checkHeldBook(ACCOUNT, 'thalex');
    [view] = (await service.list(ACCOUNT)).active;
    expect(view?.pendingFlip).not.toBeNull();

    books.set('thalex', { live: true, legs: [heldLeg(83_000, 'put', 1, 1_400)] });
    await service.checkHeldBook(ACCOUNT, 'thalex');
    [view] = (await service.list(ACCOUNT)).active;
    expect(view?.pendingFlip).toBeNull();
  });

  it('keeps every thesis and event across a restart before the daily flush', async () => {
    const clock = { now: Date.parse('2026-10-06T06:00:00Z') };
    const first = harness({ clock });
    const { thesis } = await first.service.create(ACCOUNT, bearishThesis);
    await first.service.wait(ACCOUNT, thesis.id);
    first.service.dispose();

    const second = harness({ clock });
    const [view] = (await second.service.list(ACCOUNT)).active;
    expect(view?.thesis.id).toBe(thesis.id);
    expect(view?.cooldown?.kind).toBe('wait');
  });

  it('flushes to the store, empties the outbox, and reloads from the database', async () => {
    const store = new RecordingStore();
    const clock = { now: Date.parse('2026-10-06T06:00:00Z') };
    const first = harness({ store, clock });
    const { thesis } = await first.service.create(ACCOUNT, bearishThesis);
    const flushed = await first.service.flush();
    expect(flushed).toMatchObject({ theses: 1, events: 1, pending: 0 });
    first.service.dispose();

    const second = harness({ store, clock });
    const [view] = (await second.service.list(ACCOUNT)).active;
    expect(view?.thesis.id).toBe(thesis.id);
    expect(await second.service.flush()).toMatchObject({ theses: 0, events: 0, pending: 0 });
  });

  it('scopes theses to their account', async () => {
    const { service } = harness();
    const { thesis } = await service.create(ACCOUNT, bearishThesis);
    await expect(service.end('acct_other', thesis.id, undefined)).rejects.toMatchObject({ code: 'not_found' });
    expect((await service.list('acct_other')).active).toHaveLength(0);
  });

  it('shares a thesis, carries the share across a flip, and keeps ended theses in the feed', async () => {
    const { service, clock } = harness();
    const { thesis } = await service.create(ACCOUNT, bearishThesis);
    expect(await service.shared(10)).toHaveLength(0);

    const shared = await service.setShared(ACCOUNT, thesis.id, 'user_1');
    expect(shared.thesis.share).toMatchObject({ userId: 'user_1' });
    const [entry] = await service.shared(10);
    expect(entry).toMatchObject({ thesis: { id: thesis.id }, status: { status: 'INTACT' }, spotUsd: 84_000 });
    clock.now += HOUR_MS;

    const next = await service.flip(ACCOUNT, thesis.id, {
      reason: 'Spot reclaimed 84k on rising volume and the funding reset; I no longer expect 80k.',
      confirmation: THESIS_FLIP_CONFIRMATION,
      newThesis: {
        direction: 'bullish',
        horizonExpiry: '2026-10-30',
        level: 81_500,
        reason: 'Reclaim of 84k holds; wrong below 81.5k.',
      },
    });
    expect(next.thesis.share).toMatchObject({ userId: 'user_1' });
    const feed = await service.shared(10);
    expect(feed.map((item) => [item.thesis.id, item.thesis.state, item.status?.status ?? null])).toEqual([
      [next.thesis.id, 'active', 'INTACT'],
      [thesis.id, 'overridden', null],
    ]);

    await service.setShared(ACCOUNT, thesis.id, null);
    expect((await service.shared(10)).map((item) => item.thesis.id)).toEqual([next.thesis.id]);
    await expect(service.setShared(ACCOUNT, thesis.id, 'user_1')).rejects.toMatchObject({ code: 'not_active' });
    await expect(service.setShared('acct_other', next.thesis.id, null)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('reads records written before sharing existed as unshared', async () => {
    const store = new RecordingStore();
    const first = harness({ store });
    const { thesis } = await first.service.create(ACCOUNT, bearishThesis);
    await first.service.flush();
    const persisted = store.theses.get(thesis.id)!;
    const { share: _share, ...legacy } = persisted.record as Record<string, unknown>;
    store.theses.set(thesis.id, { ...persisted, record: legacy });

    const second = harness({ store });
    const [view] = (await second.service.list(ACCOUNT)).active;
    expect(view?.thesis.share).toBeNull();
  });
});
