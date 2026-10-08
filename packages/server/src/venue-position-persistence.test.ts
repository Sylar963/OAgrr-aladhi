import type { PositionLeg } from '@oggregator/core';
import {
  type ExchangePortfolioLedgerStore,
  NoopExchangePortfolioLedgerStore,
  type PersistedExchangePosition,
} from '@oggregator/db';
import { describe, expect, it } from 'vitest';

import { price76 } from '@oggregator/core';

import {
  carryEntryIvs,
  mergePersistedEntryIvs,
  VenuePositionPersistence,
} from './venue-position-persistence.js';

class RecordingLedger implements ExchangePortfolioLedgerStore {
  readonly enabled = true;
  private readonly noop = new NoopExchangePortfolioLedgerStore();
  readonly loadPositions = this.noop.loadPositions;
  readonly upsertTrades = this.noop.upsertTrades;
  readonly loadTrades = this.noop.loadTrades;
  readonly loadTradeSummary = this.noop.loadTradeSummary;
  readonly dispose = this.noop.dispose;
  readonly writes: string[][] = [];
  private active = 0;

  async replacePositions(
    _accountId: string,
    _venue: 'thalex' | 'derive',
    positions: PersistedExchangePosition[],
  ): Promise<void> {
    this.active += 1;
    if (this.active > 1) throw new Error('duplicate key value violates unique constraint');
    await new Promise((resolve) => setTimeout(resolve, 5));
    this.writes.push(positions.map((position) => position.legId));
    this.active -= 1;
  }
}

function leg(legId: string): PositionLeg {
  return {
    legId,
    underlying: 'BTC',
    expiry: '2026-12-25',
    strike: 100_000,
    optionRight: 'call',
    size: 1,
    entryPriceUsd: 1_000,
    entryIv: null,
    realizedPnlUsd: 0,
    entryTs: 0,
    venueHint: 'thalex',
    source: 'thalex',
  };
}

describe('VenuePositionPersistence', () => {
  it('serializes overlapping snapshot writes and keeps only the newest queued snapshot', async () => {
    const ledger = new RecordingLedger();
    const persistence = new VenuePositionPersistence('thalex', ledger);
    await persistence.hydrate('acct');

    const first = persistence.persistPositions('acct', [leg('a')]);
    await new Promise((resolve) => setTimeout(resolve, 1));
    const writes = [
      first,
      persistence.persistPositions('acct', [leg('b')]),
      persistence.persistPositions('acct', [leg('c')]),
    ];

    await expect(Promise.all(writes)).resolves.toBeDefined();
    expect(ledger.writes).toEqual([['a'], ['c']]);
  });

  it('skips writes when only marks or entry timestamps changed', async () => {
    const ledger = new RecordingLedger();
    const persistence = new VenuePositionPersistence('thalex', ledger);
    await persistence.hydrate('acct');

    await persistence.persistPositions('acct', [leg('a')]);
    await persistence.persistPositions('acct', [
      { ...leg('a'), entryTs: 99, venueMarkPriceUsd: 1_234, venueMarkTs: 99 },
    ]);
    await persistence.persistPositions('acct', [{ ...leg('a'), size: 2 }]);

    expect(ledger.writes).toEqual([['a'], ['a']]);
  });

  it('holds snapshot writes until the stored rows have been read', async () => {
    const ledger = new RecordingLedger();
    const persistence = new VenuePositionPersistence('thalex', ledger);

    await persistence.persistPositions('acct', [leg('a')]);
    expect(ledger.writes).toEqual([]);

    await persistence.hydrate('acct');
    await persistence.persistPositions('acct', [leg('a')]);
    expect(ledger.writes).toEqual([['a']]);
  });

  it('back-solves entry IV from the persisted opening fills', async () => {
    const fillMs = Date.UTC(2026, 11, 1, 12);
    const tYears = (Date.UTC(2026, 11, 25, 8) - fillMs) / (365 * 24 * 60 * 60 * 1000);
    const spot = 95_000;
    const ledger = new RecordingLedger();
    const fillLedger: ExchangePortfolioLedgerStore = Object.assign(ledger, {
      loadTrades: async () => [
        {
          tradeId: 't1',
          orderId: null,
          groupId: null,
          instrumentName: 'BTC-25DEC26-100000-C',
          underlying: 'BTC',
          expiry: '2026-12-25',
          strike: 100_000,
          optionRight: 'call' as const,
          direction: 'buy' as const,
          amount: 1,
          priceUsd: price76(spot, 100_000, 0.48, tYears, 'call'),
          feeUsd: null,
          realizedPnlUsd: null,
          liquidityRole: null,
          timestampMs: fillMs,
        },
      ],
    });
    const persistence = new VenuePositionPersistence('thalex', fillLedger, async () => spot);

    const resolved = await persistence.resolveFillEntryAnchors('acct', [leg('a')]);
    expect(resolved.get('a')?.iv).toBeCloseTo(0.48, 6);
    expect(resolved.get('a')?.underlyingUsd).toBe(spot);
  });
});

describe('carryEntryIvs', () => {
  it('keeps the fill entry time and spot when the venue restamps entryTs', () => {
    const prior = new Map([
      ['a', { ...leg('a'), entryIv: 0.5, entryIvSource: 'fill' as const, entryTs: 7, entryUnderlyingUsd: 90_000 }],
    ]);
    const [carried] = carryEntryIvs(prior, [{ ...leg('a'), entryTs: 999 }]);
    expect(carried).toMatchObject({ entryIv: 0.5, entryTs: 7, entryUnderlyingUsd: 90_000 });
  });

  it('keeps a captured entry IV across venue pushes until the leg flips side', () => {
    const prior = new Map([['a', { ...leg('a'), entryIv: 0.52 }]]);

    expect(carryEntryIvs(prior, [{ ...leg('a'), size: 2 }])[0]?.entryIv).toBe(0.52);
    expect(carryEntryIvs(prior, [{ ...leg('a'), size: -1 }])[0]?.entryIv).toBeNull();
    expect(carryEntryIvs(prior, [leg('b')])[0]?.entryIv).toBeNull();
    expect(carryEntryIvs(undefined, [leg('a')])[0]?.entryIv).toBeNull();
  });
});

describe('mergePersistedEntryIvs', () => {
  it('restores the stored anchor over a fresh first-seen IV but never over a fill IV', () => {
    const stored = [{ ...leg('a'), entryIv: 0.4 }, { ...leg('b'), entryIv: 0.41 }];
    const merged = mergePersistedEntryIvs(
      [
        { ...leg('a'), entryIv: 0.55, entryIvSource: 'first_seen' },
        { ...leg('b'), entryIv: 0.6, entryIvSource: 'fill' },
      ],
      stored,
    );

    expect(merged.map((l) => [l.entryIv, l.entryIvSource])).toEqual([
      [0.4, 'first_seen'],
      [0.6, 'fill'],
    ]);
  });
});
