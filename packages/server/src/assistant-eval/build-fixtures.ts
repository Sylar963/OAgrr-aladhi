import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  InMemoryPositionStore,
  logger,
  PortfolioRuntime,
  type PositionLeg,
  type PositionStore,
} from '@oggregator/core';
import type { PersistedExchangeTrade } from '@oggregator/db';
import type {
  PortfolioAccounting,
  PortfolioAssistantMessage,
  PortfolioSource,
} from '@oggregator/protocol';

import { AssistantMarketDataReader } from '../assistant-market/market-data-reader.js';
import {
  assemblePortfolioAssistantContext,
  buildTradeHistoryFacts,
  CONTEXT_COMPACTED_LIMITATION,
  type PortfolioAssistantContext,
  PortfolioAssistantContextBuilder,
  type PortfolioAssistantMarketFacts,
  SCENARIO_HORIZONS_DAYS,
  SCENARIO_SPOT_MOVES_PCT,
  TRADE_CONTEXT_LIMIT,
} from '../portfolio-assistant-context-builder.js';
import { readPortfolioAssistantConfiguration } from '../portfolio-assistant-configuration.js';
import {
  type AssistantEvalExpect,
  type AssistantEvalExpectedNumber,
  type AssistantEvalFixture,
  AssistantEvalFixtureSchema,
} from './assistant-eval-fixture.js';
import { SyntheticMarket, type SyntheticMarketParams } from './synthetic-market.js';

const log = logger.child({ component: 'assistant-eval-fixtures' });

const NOW_MS = Date.parse('2026-10-07T12:00:00.000Z');
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const REFERENCE_SPOT_USD = 83_886.66;
const ACCOUNT_ID = 'eval-account';
// Fixtures are offline, so no live ref store resolves this; the runner only needs the field present.
const FIXTURE_PORTFOLIO_REF = 'pref_evalFixtureNotResolvable';
const GENERATOR = 'packages/server/src/assistant-eval/build-fixtures.ts';
const FIXTURE_DIRECTORY = fileURLToPath(new URL('./fixtures/', import.meta.url));


const DEFAULT_BANNED_PHRASES = [
  'I cannot identify',
  "I can't identify",
  'I cannot propose',
  "I can't propose",
  'my earlier … were wrong',
  'my earlier … was wrong',
  'my previous … were wrong',
  'my previous … was wrong',
];

const MARKET_DEFAULTS: Omit<SyntheticMarketParams, 'spotUsd' | 'nowMs'> = {
  underlying: 'BTC',
  basisPerYear: 0.03,
  atmFloor: 0.4,
  atmFrontPremium: 0.08,
  skew: -0.15,
  curvature: 0.6,
};

interface LegSpec {
  legId: string;
  expiry: string;
  strike: number;
  right: 'call' | 'put';
  size: number;
  entryPriceUsd: number;
}

interface BookSpec {
  source: PortfolioSource;
  spotUsd: number;
  nowMs: number;
  legs: LegSpec[];
  trades?: PersistedExchangeTrade[];
  forwardDays?: number;
}

function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

function toPositionLeg(spec: LegSpec, source: PortfolioSource, nowMs: number): PositionLeg {
  return {
    legId: spec.legId,
    underlying: 'BTC',
    expiry: spec.expiry,
    strike: spec.strike,
    optionRight: spec.right,
    size: spec.size,
    entryPriceUsd: spec.entryPriceUsd,
    entryIv: null,
    realizedPnlUsd: 0,
    entryTs: nowMs - 5 * DAY_MS,
    venueHint: null,
    source,
  };
}

function ledgerAccounting(legs: PositionLeg[], trades: PersistedExchangeTrade[]): PortfolioAccounting {
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  const premium = (direction: 'buy' | 'sell') =>
    sum(trades.filter((trade) => trade.direction === direction).map((trade) => trade.priceUsd * trade.amount));
  const openGrossDebitUsd = sum(legs.filter((leg) => leg.size > 0).map((leg) => leg.entryPriceUsd * leg.size));
  const openGrossCreditUsd = sum(legs.filter((leg) => leg.size < 0).map((leg) => leg.entryPriceUsd * -leg.size));
  return {
    openGrossDebitUsd,
    openGrossCreditUsd,
    openNetPremiumUsd: openGrossDebitUsd - openGrossCreditUsd,
    lifetimeGrossDebitUsd: premium('buy'),
    lifetimeGrossCreditUsd: premium('sell'),
    knownFeesUsd: sum(trades.map((trade) => trade.feeUsd ?? 0)),
    realizedPnlUsd: sum(trades.map((trade) => trade.realizedPnlUsd ?? 0)),
    persistedTradeCount: trades.length,
    historyFromMs: Math.min(...trades.map((trade) => trade.timestampMs)),
    lastSyncedAtMs: NOW_MS - MINUTE_MS,
    persistence: 'venue_history',
  };
}

function storeFor(book: BookSpec, legs: PositionLeg[]): PositionStore {
  const store = new InMemoryPositionStore();
  for (const leg of legs) store.upsert(ACCOUNT_ID, leg);
  const trades = book.trades;
  if (trades == null) return store;
  return {
    list: (accountId) => store.list(accountId),
    get: (accountId, legId) => store.get(accountId, legId),
    upsert: (accountId, leg) => store.upsert(accountId, leg),
    remove: (accountId, legId) => store.remove(accountId, legId),
    subscribe: (listener) => store.subscribe(listener),
    getAccounting: () => ledgerAccounting(legs, trades),
  };
}

async function buildContext(book: BookSpec): Promise<PortfolioAssistantContext> {
  const forwardDays = book.forwardDays ?? 0;
  const market = new SyntheticMarket({ ...MARKET_DEFAULTS, spotUsd: book.spotUsd, nowMs: book.nowMs });
  const legs = book.legs.map((spec) => toPositionLeg(spec, book.source, book.nowMs));
  const runtime = new PortfolioRuntime({
    accountId: ACCOUNT_ID,
    store: storeFor(book, legs),
    markProvider: market.markProvider(),
    now: () => book.nowMs,
    underlyingFilter: 'BTC',
  });
  const snapshot = runtime.computeMetricsAt(forwardDays);
  if (snapshot.error != null) throw new Error(`engine failed: ${snapshot.error.message}`);
  const horizonScenarios = runtime.computeHorizonScenarios(
    [...SCENARIO_HORIZONS_DAYS, forwardDays],
    SCENARIO_SPOT_MOVES_PCT,
  );
  if (horizonScenarios == null) throw new Error('horizon scenarios failed');

  const reader = new AssistantMarketDataReader(() => book.nowMs);
  reader.bind(market.injector());
  const configuration = readPortfolioAssistantConfiguration({});
  const builder = new PortfolioAssistantContextBuilder(configuration, reader, null, () => book.nowMs);
  // Element access reaches the private method so marketFacts come from the production code path.
  const marketFacts: PortfolioAssistantMarketFacts = await builder['buildMarketFacts'](
    snapshot.positions,
    'BTC',
    snapshot.metrics.pnlCurve.currentSpotUsd,
  );

  const limitations: string[] = [];
  const venue = book.source === 'thalex' || book.source === 'derive' ? book.source : null;
  const tradeHistoryFacts =
    venue != null && book.trades != null
      ? buildTradeHistoryFacts(venue, book.trades, 'BTC', TRADE_CONTEXT_LIMIT)
      : null;
  if (venue != null && book.trades == null) {
    limitations.push('Venue trade history is unavailable because the trade ledger is not configured.');
  }

  // The live builder's runtime needs chain feeds, so the eval feeds the same assembly from a synthetic market.
  const context = assemblePortfolioAssistantContext({
    source: book.source,
    underlying: 'BTC',
    forwardDays,
    nowMs: book.nowMs,
    portfolioRef: FIXTURE_PORTFOLIO_REF,
    computation: snapshot,
    legsWithMarks: runtime.legsWithMarks(),
    horizonScenarios,
    marketFacts,
    tradeHistoryFacts,
    limitations,
    maxContextCharacters: configuration.maxContextCharacters,
  });
  if (context.limitations.includes(CONTEXT_COMPACTED_LIMITATION)) {
    throw new Error(`context exceeded the ${configuration.maxContextCharacters} character budget`);
  }
  return context;
}

function usdTolerance(value: number): number {
  return roundCents(Math.max(1, Math.abs(value) * 0.005));
}

function engineNumber(label: string, value: number | null | undefined, source: string): AssistantEvalExpectedNumber {
  if (value == null || !Number.isFinite(value)) throw new Error(`engine produced no value for ${source}`);
  return { label, value: roundCents(value), tolerance: usdTolerance(value), source };
}

function spotNumber(label: string, value: number | null, source: string): AssistantEvalExpectedNumber {
  if (value == null) throw new Error(`engine produced no spot for ${source}`);
  return { label, value: roundCents(value), tolerance: roundCents(Math.max(2, value * 0.0005)), source };
}

function scenarioCell(context: PortfolioAssistantContext, horizonDays: number, spotMovePct: number) {
  const cell = context.horizonScenarios?.cells.find(
    (item) => item.horizonDays === horizonDays && item.spotMovePct === spotMovePct,
  );
  if (cell == null) throw new Error(`missing horizon cell ${horizonDays}d ${spotMovePct}%`);
  return cell;
}

function maxLoss(context: PortfolioAssistantContext): AssistantEvalExpectedNumber {
  return engineNumber('current book max loss', context.payoffFacts.maxLossUsd, 'payoffFacts.maxLossUsd');
}

// The pre-window engine reported this common-spot low as max loss; the stale answer quotes it.
function samePriceExpiryLow(context: PortfolioAssistantContext): number {
  return Math.min(...context.payoffFacts.points.map((point) => point.expiryPnlUsd));
}

function budgetAbove(lossUsd: number | null, headroomUsd: number): number {
  if (lossUsd == null) throw new Error('budget needs a bounded engine max loss');
  return Math.ceil((Math.abs(lossUsd) + headroomUsd) / 100) * 100;
}

function usd(value: number, digits = 2): string {
  return `$${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function messageId(index: number): string {
  return `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`;
}

function staleHistory(
  stale: PortfolioAssistantContext,
  question: string,
  extraBullets: string[],
  firstId: number,
): PortfolioAssistantMessage[] {
  const pnl = stale.headline.unrealizedPnlUsd ?? 0;
  const spot = stale.headline.spotUsd ?? 0;
  const answer = [
    `Your book is **${pnl >= 0 ? 'up' : 'down'} ${usd(pnl)}** with BTC at **${usd(spot)}**.`,
    '',
    `- **Unrealized PnL:** ${pnl < 0 ? '-' : ''}${usd(pnl)}`,
    `- **Spot:** ${usd(spot)}`,
    `- **Net delta:** ${(stale.headline.netDeltaUsd ?? 0).toFixed(3)} BTC`,
    ...extraBullets,
  ].join('\n');
  return [
    {
      messageId: messageId(firstId),
      role: 'user',
      content: question,
      status: 'complete',
      portfolioGeneratedAt: null,
      createdAt: stale.generatedAt - MINUTE_MS,
    },
    {
      messageId: messageId(firstId + 1),
      role: 'assistant',
      content: answer,
      status: 'complete',
      portfolioGeneratedAt: stale.generatedAt,
      createdAt: stale.generatedAt,
    },
  ];
}

function expectation(overrides: Partial<AssistantEvalExpect>): AssistantEvalExpect {
  return {
    numbers: [],
    requiredMentions: [],
    requiredTools: [],
    mustProposeStructure: false,
    requireNewLeg: false,
    bannedPhrases: DEFAULT_BANNED_PHRASES,
    maxChars: 4_000,
    ...overrides,
  };
}

function instrument(expiry: string, strike: number, right: 'call' | 'put'): string {
  const date = new Date(`${expiry}T00:00:00.000Z`);
  const month = date.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }).toUpperCase();
  const day = date.getUTCDate().toString().padStart(2, '0');
  return `BTC-${day}${month}${expiry.slice(2, 4)}-${strike}-${right === 'call' ? 'C' : 'P'}`;
}

interface FillSpec {
  tradeId: string;
  orderId: string;
  expiry: string;
  strike: number;
  right: 'call' | 'put';
  direction: 'buy' | 'sell';
  amount: number;
  priceUsd: number;
  ageMinutes: number;
  role: 'maker' | 'taker';
  openedAtPriceUsd?: number;
}

function toTrade(fill: FillSpec): PersistedExchangeTrade {
  const notionalFee = 0.0003 * REFERENCE_SPOT_USD * fill.amount;
  const cappedFee = Math.min(notionalFee, 0.125 * fill.priceUsd * fill.amount);
  const realized =
    fill.openedAtPriceUsd == null
      ? null
      : (fill.direction === 'sell'
          ? fill.priceUsd - fill.openedAtPriceUsd
          : fill.openedAtPriceUsd - fill.priceUsd) * fill.amount;
  return {
    tradeId: fill.tradeId,
    orderId: fill.orderId,
    groupId: null,
    instrumentName: instrument(fill.expiry, fill.strike, fill.right),
    underlying: 'BTC',
    expiry: fill.expiry,
    strike: fill.strike,
    optionRight: fill.right,
    direction: fill.direction,
    amount: fill.amount,
    priceUsd: fill.priceUsd,
    feeUsd: roundCents(fill.role === 'maker' ? cappedFee * 0.5 : cappedFee),
    realizedPnlUsd: realized == null ? null : roundCents(realized),
    liquidityRole: fill.role,
    timestampMs: NOW_MS - fill.ageMinutes * MINUTE_MS,
  };
}

const THALEX_FILLS: FillSpec[] = [
  { tradeId: 'fill-01', orderId: 'order-01', expiry: '2026-10-30', strike: 85_000, right: 'call', direction: 'sell', amount: 0.5, priceUsd: 3_020, ageMinutes: 1_450, role: 'maker' },
  { tradeId: 'fill-02', orderId: 'order-02', expiry: '2026-10-30', strike: 85_000, right: 'call', direction: 'sell', amount: 0.5, priceUsd: 3_043.9, ageMinutes: 1_445, role: 'taker' },
  { tradeId: 'fill-03', orderId: 'order-03', expiry: '2026-11-27', strike: 95_000, right: 'call', direction: 'buy', amount: 1, priceUsd: 1_180, ageMinutes: 4_320, role: 'taker' },
  { tradeId: 'fill-04', orderId: 'order-04', expiry: '2026-10-16', strike: 80_000, right: 'put', direction: 'buy', amount: 1, priceUsd: 410, ageMinutes: 5_760, role: 'maker', openedAtPriceUsd: 640 },
  { tradeId: 'fill-05', orderId: 'order-05', expiry: '2026-10-16', strike: 80_000, right: 'put', direction: 'sell', amount: 1, priceUsd: 640, ageMinutes: 7_200, role: 'taker' },
  { tradeId: 'fill-06', orderId: 'order-06', expiry: '2026-10-09', strike: 90_000, right: 'call', direction: 'sell', amount: 0.3, priceUsd: 520, ageMinutes: 8_640, role: 'taker', openedAtPriceUsd: 900 },
  { tradeId: 'fill-07', orderId: 'order-07', expiry: '2026-10-09', strike: 90_000, right: 'call', direction: 'buy', amount: 0.3, priceUsd: 900, ageMinutes: 11_520, role: 'taker' },
  { tradeId: 'fill-08', orderId: 'order-08', expiry: '2026-10-23', strike: 75_000, right: 'put', direction: 'sell', amount: 2, priceUsd: 180, ageMinutes: 10_080, role: 'maker', openedAtPriceUsd: 300 },
  { tradeId: 'fill-09', orderId: 'order-09', expiry: '2026-10-23', strike: 75_000, right: 'put', direction: 'buy', amount: 2, priceUsd: 300, ageMinutes: 14_400, role: 'taker' },
];

function thalexBook(): BookSpec {
  const trades = THALEX_FILLS.map(toTrade);
  const shortFills = trades.filter((trade) => trade.instrumentName === instrument('2026-10-30', 85_000, 'call'));
  const shortSize = shortFills.reduce((sum, trade) => sum + trade.amount, 0);
  const shortEntry = shortFills.reduce((sum, trade) => sum + trade.priceUsd * trade.amount, 0) / shortSize;
  return {
    source: 'thalex',
    spotUsd: REFERENCE_SPOT_USD,
    nowMs: NOW_MS,
    trades,
    legs: [
      { legId: 'thalex-oct30-85000-c', expiry: '2026-10-30', strike: 85_000, right: 'call', size: -shortSize, entryPriceUsd: roundCents(shortEntry) },
      { legId: 'thalex-nov27-95000-c', expiry: '2026-11-27', strike: 95_000, right: 'call', size: 1, entryPriceUsd: 1_180 },
    ],
  };
}

const REFERENCE_LEGS: LegSpec[] = [
  { legId: 'ref-oct16-87000-c', expiry: '2026-10-16', strike: 87_000, right: 'call', size: 1, entryPriceUsd: 1_050 },
  { legId: 'ref-oct30-85000-c', expiry: '2026-10-30', strike: 85_000, right: 'call', size: -1, entryPriceUsd: 3_031.95 },
];

const HORIZON_LEGS: LegSpec[] = [
  { legId: 'hz-oct30-80000-p', expiry: '2026-10-30', strike: 80_000, right: 'put', size: 1, entryPriceUsd: 1_450 },
  { legId: 'hz-nov27-95000-c', expiry: '2026-11-27', strike: 95_000, right: 'call', size: -1, entryPriceUsd: 1_600 },
  { legId: 'hz-dec25-90000-c', expiry: '2026-12-25', strike: 90_000, right: 'call', size: 0.5, entryPriceUsd: 4_100 },
];

const BEAR_PUT_SPREAD_LEGS: LegSpec[] = [
  { legId: 'bps-oct30-82000-p', expiry: '2026-10-30', strike: 82_000, right: 'put', size: 1, entryPriceUsd: 2_150 },
  { legId: 'bps-oct30-76000-p', expiry: '2026-10-30', strike: 76_000, right: 'put', size: -1, entryPriceUsd: 640 },
];

const LONG_CALL_LEGS: LegSpec[] = [
  { legId: 'lc-nov27-90000-c', expiry: '2026-11-27', strike: 90_000, right: 'call', size: 0.5, entryPriceUsd: 2_350 },
];

const IRON_CONDOR_LEGS: LegSpec[] = [
  { legId: 'ic-oct30-74000-p', expiry: '2026-10-30', strike: 74_000, right: 'put', size: 1, entryPriceUsd: 380 },
  { legId: 'ic-oct30-78000-p', expiry: '2026-10-30', strike: 78_000, right: 'put', size: -1, entryPriceUsd: 900 },
  { legId: 'ic-oct30-90000-c', expiry: '2026-10-30', strike: 90_000, right: 'call', size: -1, entryPriceUsd: 1_100 },
  { legId: 'ic-oct30-94000-c', expiry: '2026-10-30', strike: 94_000, right: 'call', size: 1, entryPriceUsd: 480 },
];

const BEAR_CALL_SPREAD_LEGS: LegSpec[] = [
  { legId: 'bcs-oct30-84000-c', expiry: '2026-10-30', strike: 84_000, right: 'call', size: -1, entryPriceUsd: 3_000 },
  { legId: 'bcs-oct30-90000-c', expiry: '2026-10-30', strike: 90_000, right: 'call', size: 1, entryPriceUsd: 1_000 },
];

function manualBook(legs: LegSpec[], spotUsd = REFERENCE_SPOT_USD, nowMs = NOW_MS): BookSpec {
  return { source: 'manual', spotUsd, nowMs, legs };
}

const UNBOUNDED_MENTION = {
  label: 'short Oct 30 call is uncovered after the Oct 16 expiry',
  anyOf: [
    'unbounded',
    'unlimited',
    'uncovered',
    'naked',
    'uncapped',
    'no cap',
    'not covered',
    'remains open',
    'remain open',
    'stays open',
  ],
};

type FixtureDraft = Omit<AssistantEvalFixture, 'provenance'> & { notes?: string[] };

async function buildDrafts(): Promise<FixtureDraft[]> {
  const reference = await buildContext(manualBook(REFERENCE_LEGS));
  const referenceStale = await buildContext(manualBook(REFERENCE_LEGS, 82_950, NOW_MS - 2 * 60 * MINUTE_MS));
  const longCall = await buildContext(manualBook(LONG_CALL_LEGS));
  const bearPut = await buildContext(manualBook(BEAR_PUT_SPREAD_LEGS));
  const bearPutStale = await buildContext(manualBook(BEAR_PUT_SPREAD_LEGS, 86_400, NOW_MS - 3 * 60 * MINUTE_MS));
  const condor = await buildContext(manualBook(IRON_CONDOR_LEGS));
  const horizon = await buildContext(manualBook(HORIZON_LEGS));
  const bearCall = await buildContext(manualBook(BEAR_CALL_SPREAD_LEGS));
  const thalex = await buildContext(thalexBook());

  const longCallBudget = budgetAbove(longCall.payoffFacts.maxLossUsd, 1_000);
  const bearPutBudget = budgetAbove(bearPut.payoffFacts.maxLossUsd, 1_000);
  const condorBudget = budgetAbove(condor.payoffFacts.maxLossUsd, 1_100);
  const bearCallBudget = Math.floor(Math.abs(bearCall.payoffFacts.maxLossUsd ?? 0) / 3 / 100) * 100;

  const plus5in10 = scenarioCell(horizon, 10, 5);
  const minus10in7 = scenarioCell(horizon, 7, -10);
  const bearPutMinus5in3 = scenarioCell(bearPut, 3, -5);

  const recentTrades = thalex.tradeHistoryFacts?.trades ?? [];
  const lastFive = recentTrades.slice(0, 5);
  const lastFiveFees = lastFive.reduce((sum, trade) => sum + (trade.feeUsd ?? 0), 0);
  const largestFee = Math.max(...lastFive.map((trade) => trade.feeUsd ?? 0));
  const shortCallSales = recentTrades.filter(
    (trade) => trade.instrument === instrument('2026-10-30', 85_000, 'call') && trade.side === 'sell',
  );
  const averageSale =
    shortCallSales.reduce((sum, trade) => sum + trade.priceUsd * trade.amount, 0) /
    shortCallSales.reduce((sum, trade) => sum + trade.amount, 0);
  const realizedTotal = recentTrades.reduce((sum, trade) => sum + (trade.realizedPnlUsd ?? 0), 0);

  return [
    {
      id: 'reference-bearish-budget-18',
      description:
        'Reference failure: +1 Oct 16 87k call / -1 Oct 30 85k call, bearish trade within $18 total risk, with stale-spot history.',
      scenario: 'reference_diagonal',
      question:
        "I'm bearish from here. Propose a trade that keeps my TOTAL portfolio max loss within $18.",
      history: staleHistory(
        referenceStale,
        'How is my diagonal doing?',
        [`- **Max loss at expiry:** ${usd(samePriceExpiryLow(referenceStale))}`],
        1,
      ),
      context: reference,
      expect: expectation({
        requiredMentions: [UNBOUNDED_MENTION],
        mustProposeStructure: true,
        requireNewLeg: true,
        maxChars: 4_500,
      }),
      notes: [
        'payoffFacts.maxLossUsd is null: riskWindows flags the short Oct 30 call as uncovered after Oct 16. The stale history quotes the old same-price expiry low.',
      ],
    },
    {
      id: 'reference-max-loss',
      description: 'Reference book: worst-case loss question that must flag the uncovered short after Oct 16.',
      scenario: 'reference_diagonal',
      question: 'What is the most I can lose on this book?',
      history: [],
      context: reference,
      expect: expectation({
        requiredMentions: [
          UNBOUNDED_MENTION,
          { label: 'names the Oct 16 expiry', anyOf: ['Oct 16', 'October 16', '2026-10-16', '16 Oct'] },
        ],
        maxChars: 3_000,
      }),
    },
    {
      id: 'reference-cap-upside',
      description: 'Reference book: hedge the uncovered Oct 30 short call within a cost limit.',
      scenario: 'reference_diagonal',
      question:
        'How do I cap the upside risk on my short Oct 30 85k call once my Oct 16 call expires? Keep the extra cost under $1,500.',
      history: [],
      context: reference,
      expect: expectation({
        requiredMentions: [{ label: 'names the Oct 30 expiry', anyOf: ['Oct 30', 'October 30', '2026-10-30', '30 Oct'] }],
        mustProposeStructure: true,
      }),
    },
    {
      id: 'budget-bearish-long-call',
      description: 'Long Nov 27 90k calls; find a bearish trade within a total max-loss budget.',
      scenario: 'budget_trade',
      question: `I'm turning bearish into November. Find me a bearish trade so my total portfolio max loss stays within $${longCallBudget.toLocaleString('en-US')}.`,
      history: [],
      context: longCall,
      expect: expectation({ numbers: [maxLoss(longCall)], mustProposeStructure: true, requireNewLeg: true }),
    },
    {
      id: 'budget-bullish-bear-put-spread',
      description: 'Oct 30 82k/76k bear put spread; find a bullish trade within a total max-loss budget.',
      scenario: 'budget_trade',
      question: `BTC looks like it is basing here. I want a bullish trade, but my total portfolio max loss must stay within $${bearPutBudget.toLocaleString('en-US')}.`,
      history: [],
      context: bearPut,
      expect: expectation({ numbers: [maxLoss(bearPut)], mustProposeStructure: true, requireNewLeg: true }),
    },
    {
      id: 'budget-long-vol-condor',
      description: 'Short Oct 30 iron condor; add long volatility within a total max-loss budget.',
      scenario: 'budget_trade',
      question: `I'm short vol through this condor but there is CPI next week. Add a long-vol trade so my total max loss stays within $${condorBudget.toLocaleString('en-US')}.`,
      history: [],
      context: condor,
      expect: expectation({ numbers: [maxLoss(condor)], mustProposeStructure: true, requireNewLeg: true }),
    },
    {
      id: 'horizon-plus5-10d',
      description: 'Mixed-expiry book; horizon grid lookup for spot +5% in 10 days.',
      scenario: 'horizon_lookup',
      question: 'What happens to my P&L if BTC is up 5% in 10 days?',
      history: [],
      context: horizon,
      expect: expectation({
        numbers: [
          engineNumber('PnL at +5% after 10 days', plus5in10.pnlUsd, 'horizonScenarios[10d,+5%].pnlUsd'),
          spotNumber('spot at +5%', plus5in10.spotUsd, 'horizonScenarios[10d,+5%].spotUsd'),
        ],
        maxChars: 3_000,
      }),
    },
    {
      id: 'horizon-minus10-7d-by-expiry',
      description: 'Mixed-expiry book; horizon lookup for spot -10% in 7 days with the per-expiry split.',
      scenario: 'horizon_lookup',
      question: 'If BTC drops 10% over the next 7 days, what is my P&L and which expiry drives it?',
      history: [],
      context: horizon,
      expect: expectation({
        numbers: [
          engineNumber('PnL at -10% after 7 days', minus10in7.pnlUsd, 'horizonScenarios[7d,-10%].pnlUsd'),
          ...Object.entries(minus10in7.pnlByExpiryUsd).map(([expiry, pnl]) =>
            engineNumber(`${expiry} contribution`, pnl, `horizonScenarios[7d,-10%].pnlByExpiryUsd.${expiry}`),
          ),
        ],
        maxChars: 3_000,
      }),
    },
    {
      id: 'trade-history-fees',
      description: 'Thalex book with ledger fills; fee question over the most recent fills.',
      scenario: 'trade_history',
      question: 'How much did I pay in fees on my last 5 fills, and which fill had the biggest fee?',
      history: [],
      context: thalex,
      expect: expectation({
        numbers: [
          engineNumber('fees on the last 5 fills', lastFiveFees, 'tradeHistoryFacts.trades[0..4].feeUsd sum'),
          engineNumber('largest fee in the last 5 fills', largestFee, 'tradeHistoryFacts.trades[0..4].feeUsd max'),
        ],
        maxChars: 2_500,
      }),
    },
    {
      id: 'trade-history-realized',
      description: 'Thalex book with ledger fills; average sale price and realized PnL from fills.',
      scenario: 'trade_history',
      question:
        'What was my average sale price on the Oct 30 85k call, and how much realized PnL have my closed BTC trades booked?',
      history: [],
      context: thalex,
      expect: expectation({
        numbers: [
          engineNumber('average Oct 30 85k call sale price', averageSale, 'tradeHistoryFacts sell fills, size-weighted'),
          engineNumber('realized PnL from listed fills', realizedTotal, 'tradeHistoryFacts.trades[].realizedPnlUsd sum'),
        ],
        maxChars: 2_500,
      }),
    },
    {
      id: 'market-flow-and-health',
      description: 'Market-wide question that needs trade flow and feed health tools.',
      scenario: 'market_tools',
      question:
        'Forget my book for a second: what is BTC options flow doing right now, and are all the data feeds healthy?',
      history: [],
      context: longCall,
      expect: expectation({
        requiredTools: ['oggregator_trade_flow', 'oggregator_feed_health'],
        maxChars: 3_500,
      }),
      notes: ['Tool results are live; only tool usage and format are graded.'],
    },
    {
      id: 'market-off-book-chain',
      description: 'Quote request for an expiry outside the held book, so it needs the option chain tool.',
      scenario: 'market_tools',
      question: 'What is the best bid/ask and IV on the BTC 2027-03-26 100k call right now?',
      history: [],
      context: bearPut,
      expect: expectation({ requiredTools: ['oggregator_option_chain'], maxChars: 2_000 }),
      notes: ['Tool results are live; only tool usage and format are graded.'],
    },
    {
      id: 'stale-history-followup',
      description: 'Follow-up whose history quotes an older spot and PnL; answer must use current context without apologising.',
      scenario: 'stale_history',
      question: 'And if BTC falls 5% over the next 3 days?',
      history: staleHistory(bearPutStale, 'How is my put spread doing?', [], 11),
      context: bearPut,
      expect: expectation({
        numbers: [
          engineNumber('PnL at -5% after 3 days', bearPutMinus5in3.pnlUsd, 'horizonScenarios[3d,-5%].pnlUsd'),
        ],
        maxChars: 2_500,
      }),
      notes: [`History spot ${usd(bearPutStale.headline.spotUsd ?? 0)} is stale; current spot is in headline.`],
    },
    {
      id: 'infeasible-budget-bear-call-spread',
      description:
        'Bear call spread whose max loss already exceeds the requested total budget; expect the closest feasible structure plus the gap.',
      scenario: 'infeasible_budget',
      question: `I want to add a bearish trade but keep my TOTAL portfolio max loss within $${bearCallBudget.toLocaleString('en-US')}.`,
      history: [],
      context: bearCall,
      expect: expectation({
        numbers: [maxLoss(bearCall)],
        requiredMentions: [
          {
            label: 'states the budget gap or closest feasible option',
            anyOf: ['gap', 'shortfall', 'exceed', 'short of', 'over budget', 'over your budget', 'above your', 'closest'],
          },
        ],
        mustProposeStructure: true,
        requireNewLeg: true,
      }),
    },
  ];
}

async function main(): Promise<void> {
  const drafts = await buildDrafts();
  mkdirSync(FIXTURE_DIRECTORY, { recursive: true });
  for (const file of readdirSync(FIXTURE_DIRECTORY)) {
    if (file.endsWith('.json')) rmSync(`${FIXTURE_DIRECTORY}${file}`);
  }
  for (const { notes, ...draft } of drafts) {
    const fixture = AssistantEvalFixtureSchema.parse({
      ...draft,
      provenance: {
        generator: GENERATOR,
        nowIso: new Date(draft.context.generatedAt).toISOString(),
        notes: notes ?? [],
      },
    });
    const body = `${JSON.stringify(fixture, null, 2)}\n`;
    writeFileSync(`${FIXTURE_DIRECTORY}${fixture.id}.json`, body);
    log.info(
      { fixture: fixture.id, contextChars: JSON.stringify(fixture.context).length },
      'assistant eval fixture written',
    );
  }
}

main().catch((error: unknown) => {
  log.error({ err: error }, 'assistant eval fixture build failed');
  process.exitCode = 1;
});
