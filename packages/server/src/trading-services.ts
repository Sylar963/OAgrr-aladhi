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
  OptimisticFillModel,
  OrderPlacementService,
  PaperFillEngine,
  PnlService,
  PostgresOrderRepository,
  PostgresPositionRepository,
  RealisticFillModel,
  RuntimeQuoteProvider,
  SystemClock,
  type FillModel,
} from '@oggregator/trading';
import { chainEngines } from './chain-engines.js';

export const paperTradingStore: PaperTradingStore = process.env['DATABASE_URL']
  ? PostgresPaperTradingStore.fromConnectionString(process.env['DATABASE_URL'])
  : new NoopPaperTradingStore();

const clock = new SystemClock();
const quoteProvider = new RuntimeQuoteProvider(chainEngines);
const orderRepository = new PostgresOrderRepository(paperTradingStore);
const positionRepository = new PostgresPositionRepository(paperTradingStore);

// PAPER_FILL_MODE selects the slippage model. Default is 'realistic' so paper
// fills experience depth/spread degradation similar to live execution. Set
// PAPER_FILL_MODE=optimistic for the legacy infinite-depth behavior (useful
// when comparing strategy backtests against an idealized baseline).
const fillModeEnv = (process.env['PAPER_FILL_MODE'] ?? 'realistic').toLowerCase();
const fillModel: FillModel =
  fillModeEnv === 'optimistic' ? new OptimisticFillModel() : new RealisticFillModel();
const fillEngine = new PaperFillEngine(quoteProvider, clock, fillModel);

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
  return getAccount(DEFAULT_ACCOUNT_ID);
}

export async function getAccount(accountId: string): Promise<PaperAccountRow | null> {
  if (!paperTradingStore.enabled) return null;
  return paperTradingStore.getAccount(accountId);
}

export async function resetDefaultAccount(initialCashUsd: number): Promise<PaperAccountRow> {
  return resetAccount(DEFAULT_ACCOUNT_ID, DEFAULT_ACCOUNT_LABEL, initialCashUsd);
}

// Reset the specified account: wipes trades/orders/fills/positions/cash-ledger and
// re-seeds cash with `initialCashUsd`. Used by the per-user `/paper/account/init`
// endpoint so a logged-in user's Reset button actually clears *their* history,
// not the shared default account.
export async function resetAccount(
  accountId: string,
  label: string,
  initialCashUsd: number,
): Promise<PaperAccountRow> {
  const row: PaperAccountRow = {
    id: accountId,
    label,
    initialCashUsd,
    createdAt: new Date(),
  };
  await paperTradingStore.resetAccount(row);
  if (accountId === DEFAULT_ACCOUNT_ID) ensured = true;
  return row;
}

export { DEFAULT_ACCOUNT_ID } from '@oggregator/trading';
