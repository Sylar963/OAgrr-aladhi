import { randomUUID } from 'node:crypto';
import { type FundedStore, NoopFundedStore, PostgresFundedStore } from '@oggregator/db';
import { FundedEngine } from '@oggregator/funded';
import type { OrderLeg } from '@oggregator/trading';
import {
  orderPlacementService,
  paperTradingStore,
  pnlService,
  positionRepository,
} from './trading-services.js';

const databaseUrl = process.env['DATABASE_URL'];

export const fundedStore: FundedStore = databaseUrl
  ? PostgresFundedStore.fromConnectionString(databaseUrl)
  : new NoopFundedStore();

export function isFundedEnabled(): boolean {
  const v = process.env['FUNDED_PROGRAM_ENABLED'];
  return v === '1' || v === 'true';
}

async function ensureFundedAccount(accountId: string, initialCashUsd: number): Promise<void> {
  await paperTradingStore.ensureAccount({
    id: accountId,
    label: `Funded ${accountId}`,
    initialCashUsd,
    createdAt: new Date(),
  });
}

async function closeAllFundedPositions(accountId: string): Promise<void> {
  const open = await positionRepository.listPositions(accountId);
  const legs: Array<Omit<OrderLeg, 'index'>> = open
    .filter((pos) => pos.netQuantity !== 0)
    .map((pos) => ({
      side: pos.netQuantity > 0 ? 'sell' : 'buy',
      optionRight: pos.key.optionRight,
      underlying: pos.key.underlying,
      expiry: pos.key.expiry,
      strike: pos.key.strike,
      quantity: Math.abs(pos.netQuantity),
      preferredVenues: null,
    }));
  if (legs.length === 0) return;
  await orderPlacementService.place({ accountId, legs, venueFilter: [] });
}

export const fundedEngine = new FundedEngine({
  store: fundedStore,
  equitySnapshot: async (paperAccountId: string) => {
    const snap = await pnlService.snapshot(paperAccountId);
    return snap.equityUsd;
  },
  ensureAccount: ensureFundedAccount,
  closeAllPositions: closeAllFundedPositions,
  newId: (prefix: string) => `${prefix}_${randomUUID()}`,
  now: () => new Date(),
});
