import type { PositionLeg } from '@oggregator/core';
import {
  type ExchangePortfolioLedgerStore,
  NoopExchangePortfolioLedgerStore,
  type PersistedExchangePosition,
} from '@oggregator/db';
import { describe, expect, it } from 'vitest';

import { VenuePositionPersistence } from './venue-position-persistence.js';

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
});
