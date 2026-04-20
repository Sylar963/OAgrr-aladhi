import {
  NoopPaperTradingStore,
  PostgresPaperTradingStore,
  type PaperAccountRow,
  type PaperTradingStore,
} from '@oggregator/db';
import {
  DEFAULT_ACCOUNT_ID,
  DEFAULT_ACCOUNT_LABEL,
  DEFAULT_INITIAL_CASH_USD,
  OrderPlacementService,
  PaperFillEngine,
  PnlService,
  PostgresOrderRepository,
  PostgresPositionRepository,
  RuntimeQuoteProvider,
  SystemClock,
} from '@oggregator/trading';
import { chainEngines } from './chain-engines.js';

export const paperTradingStore: PaperTradingStore = process.env['DATABASE_URL']
  ? PostgresPaperTradingStore.fromConnectionString(process.env['DATABASE_URL'])
  : new NoopPaperTradingStore();

const clock = new SystemClock();
const quoteProvider = new RuntimeQuoteProvider(chainEngines);
const orderRepository = new PostgresOrderRepository(paperTradingStore);
const positionRepository = new PostgresPositionRepository(paperTradingStore);
const fillEngine = new PaperFillEngine(quoteProvider, clock);

export const orderPlacementService = new OrderPlacementService(
  orderRepository,
  positionRepository,
  fillEngine,
  clock,
);

export const pnlService = new PnlService(positionRepository, quoteProvider, clock);

export { orderRepository, positionRepository, quoteProvider };

let ensured = false;

export async function ensureDefaultAccount(): Promise<void> {
  if (ensured) return;
  if (!paperTradingStore.enabled) {
    ensured = true;
    return;
  }
  await positionRepository.ensureAccount(
    DEFAULT_ACCOUNT_ID,
    DEFAULT_ACCOUNT_LABEL,
    DEFAULT_INITIAL_CASH_USD,
  );
  ensured = true;
}

export async function getDefaultAccount(): Promise<PaperAccountRow | null> {
  if (!paperTradingStore.enabled) return null;
  return paperTradingStore.getAccount(DEFAULT_ACCOUNT_ID);
}

export async function resetDefaultAccount(initialCashUsd: number): Promise<PaperAccountRow> {
  const row: PaperAccountRow = {
    id: DEFAULT_ACCOUNT_ID,
    label: DEFAULT_ACCOUNT_LABEL,
    initialCashUsd,
    createdAt: new Date(),
  };
  await paperTradingStore.resetAccount(row);
  ensured = true;
  return row;
}

export { DEFAULT_ACCOUNT_ID } from '@oggregator/trading';
