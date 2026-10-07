import { InMemoryPositionStore, PortfolioRuntime, type PositionLeg } from '@oggregator/core';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  type AssistantMcpHandler,
  type AssistantToolCallRecord,
  createAssistantMcpHandler,
  startAssistantMcpServer,
} from '../assistant-market/assistant-mcp-server.js';
import {
  AssistantRunRegistry,
  type AssistantRunToolSummary,
  type AssistantToolCallOutcome,
  emptyAssistantRunToolSummary,
} from '../assistant-market/assistant-run-registry.js';
import {
  AssistantMarketDataReader,
  type MarketInjector,
  type MarketReadResult,
} from '../assistant-market/market-data-reader.js';
import type { OptionsLibrary } from '../assistant-market/options-library.js';
import { PortfolioRefStore } from '../assistant-market/portfolio-ref.js';
import type { HeldLegsWithMarks } from '../assistant-market/structure-tool-support.js';
import type { PortfolioAssistantContext } from '../portfolio-assistant-context-builder.js';
import type { SyntheticMarket } from './synthetic-market.js';

export const EVAL_MCP_DEFAULT_PORT = 3192;
export const EVAL_MCP_TOKEN_ENV = 'OGG_ASSISTANT_EVAL_MCP_TOKEN';
export const EVAL_MCP_PORT_ENV = 'OGG_ASSISTANT_EVAL_MCP_PORT';

export type EvalDatasetSource = 'synthetic' | 'live' | 'local' | 'unavailable';

/**
 * Where each tool's data comes from in `--mcp eval`. Synthetic tools quote the fixture's market at
 * the fixture clock, so they agree with the context. Live tools carry no prices that the answer is
 * graded on. Unavailable tools would quote live prices that contradict the fixture market.
 */
export const EVAL_TOOL_SOURCES: Record<string, EvalDatasetSource> = {
  oggregator_list_underlyings: 'synthetic',
  oggregator_list_expiries: 'synthetic',
  oggregator_market_overview: 'synthetic',
  oggregator_option_chain: 'synthetic',
  oggregator_vol_surface: 'synthetic',
  oggregator_iv_history: 'synthetic',
  oggregator_evaluate_structure: 'synthetic',
  oggregator_structure_search: 'synthetic',
  oggregator_trade_flow: 'live',
  oggregator_feed_health: 'live',
  oggregator_news: 'live',
  oggregator_block_flow: 'live',
  oggregator_spot_candles: 'unavailable',
  oggregator_gamma_exposure: 'unavailable',
  oggregator_straddle_scanner: 'unavailable',
  oggregator_lotto_scanner: 'unavailable',
  oggregator_put_scanner: 'unavailable',
  search_options_library: 'local',
};

type PlatformDataset = Parameters<AssistantMarketDataReader['platformData']>[0];
type PlatformParameters = Parameters<AssistantMarketDataReader['platformData']>[1];

const LIVE_PLATFORM_DATASETS: ReadonlySet<PlatformDataset> = new Set(['flow', 'news', 'health']);
const NotesSchema = z.looseObject({ notes: z.array(z.string()) });

function evalUnavailable(dataset: string): { ok: false; error: string } {
  return {
    ok: false,
    error: `${dataset} is not available in the assistant eval: its prices would come from the live market, which differs from this portfolio snapshot.`,
  };
}

/** Read-only GETs against a running Oggregator backend, for the datasets the eval proxies live. */
export function httpMarketInjector(baseUrl: string): MarketInjector {
  return async (path) => {
    const response = await fetch(new URL(path, baseUrl), { headers: { accept: 'application/json' } });
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { statusCode: response.status, body };
  };
}

/**
 * The production reader over the fixture's synthetic market at the fixture clock, with the
 * datasets the synthetic market cannot produce either proxied to a live reader or refused.
 */
export class EvalMarketReader extends AssistantMarketDataReader {
  private readonly session: { market: SyntheticMarket };
  private readonly live: AssistantMarketDataReader | null;

  constructor(market: SyntheticMarket, live: AssistantMarketDataReader | null) {
    const session = { market };
    super(() => session.market.params.nowMs);
    this.session = session;
    this.live = live;
    this.bind((path) => this.session.market.injector()(path));
  }

  get market(): SyntheticMarket {
    return this.session.market;
  }

  setMarket(market: SyntheticMarket): void {
    this.session.market = market;
  }

  private liveNote(): string {
    return `Assistant eval: proxied from the live market. The portfolio context, chains, surface and structure tools use the snapshot at ${new Date(this.session.market.params.nowMs).toISOString()}.`;
  }

  override async platformData(
    dataset: PlatformDataset,
    parameters: PlatformParameters,
  ): Promise<MarketReadResult<unknown>> {
    if (!LIVE_PLATFORM_DATASETS.has(dataset)) return evalUnavailable(`/api/${dataset}`);
    if (this.live == null) return evalUnavailable(`/api/${dataset}`);
    const result = await this.live.platformData(dataset, parameters);
    if (!result.ok) return result;
    const withNotes = NotesSchema.safeParse(result.data);
    return withNotes.success
      ? { ok: true, data: { ...withNotes.data, notes: [...withNotes.data.notes, this.liveNote()] } }
      : result;
  }

  override async blockFlow(
    underlying: string,
    limit: number,
  ): ReturnType<AssistantMarketDataReader['blockFlow']> {
    return this.live == null ? evalUnavailable('/api/block-flow') : this.live.blockFlow(underlying, limit);
  }

  override async gammaExposure(): ReturnType<AssistantMarketDataReader['gammaExposure']> {
    return evalUnavailable('/api/gex-all-expiries');
  }
}

const DAY_MS = 86_400_000;
const EVAL_USER_ID_HASH = 'assistant-eval';

/** The fixture's held book with marks from its synthetic market, as the live runtime returns it. */
export function heldBookForContext(
  context: Pick<PortfolioAssistantContext, 'positions' | 'source' | 'underlying' | 'generatedAt'>,
  market: SyntheticMarket,
  accountId: string,
): HeldLegsWithMarks {
  const store = new InMemoryPositionStore();
  for (const position of context.positions) {
    if (position.size === 0) continue;
    const leg: PositionLeg = {
      legId: position.legId,
      underlying: position.underlying,
      expiry: position.expiry,
      strike: position.strike,
      optionRight: position.optionRight,
      size: position.size,
      entryPriceUsd: position.entryPriceUsd,
      entryIv: position.entryIv,
      realizedPnlUsd: 0,
      entryTs: context.generatedAt - 5 * DAY_MS,
      venueHint: null,
      source: context.source,
    };
    store.upsert(accountId, leg);
  }
  const runtime = new PortfolioRuntime({
    accountId,
    store,
    markProvider: market.markProvider(),
    now: () => market.params.nowMs,
    ...(context.underlying != null ? { underlyingFilter: context.underlying } : {}),
  });
  try {
    const legs = runtime.legsWithMarks();
    if (legs == null) throw new Error('fixture book could not be marked');
    return legs;
  } finally {
    runtime.dispose();
  }
}

export interface EvalRunToolCall {
  tool: string;
  outcome: AssistantToolCallOutcome;
  attribution: 'exact' | 'single_active';
}

export interface EvalRunToolUsage {
  summary: AssistantRunToolSummary;
  calls: EvalRunToolCall[];
  /** Calls during the run that could not be tied to any run (several runs in flight, no ref). */
  unattributedDuringRun: number;
}

export interface AssistantEvalMcpOptions {
  market: SyntheticMarket;
  library: OptionsLibrary;
  live: AssistantMarketDataReader | null;
  log: FastifyBaseLogger;
  now?: () => number;
}

interface EvalRunState {
  accountId: string;
  startedAt: number;
  calls: EvalRunToolCall[];
}

/**
 * The production MCP handler and tool registry over the eval market, with a ref store that resolves
 * each fixture run's held book, and per-run tool records read from the run registry's attribution.
 */
export class AssistantEvalMcp {
  readonly refs: PortfolioRefStore;
  readonly runs: AssistantRunRegistry;
  readonly reader: EvalMarketReader;
  readonly handler: AssistantMcpHandler;
  private readonly now: () => number;
  private readonly log: FastifyBaseLogger;
  private readonly books = new Map<string, HeldLegsWithMarks>();
  private readonly active = new Map<string, EvalRunState>();
  private readonly unattributedAt: number[] = [];
  private server: FastifyInstance | null = null;

  constructor(options: AssistantEvalMcpOptions) {
    this.now = options.now ?? Date.now;
    this.log = options.log;
    this.refs = new PortfolioRefStore({ now: this.now });
    this.runs = new AssistantRunRegistry({ now: this.now });
    this.reader = new EvalMarketReader(options.market, options.live);
    this.handler = createAssistantMcpHandler({
      reader: this.reader,
      library: options.library,
      portfolio: {
        refs: this.refs,
        resolveHeldLegs: async (scope) => this.books.get(scope.accountId) ?? null,
      },
      runs: this.runs,
      log: options.log,
      toolClock: () => this.reader.market.params.nowMs,
      onToolCall: (record) => this.record(record),
    });
  }

  /** Switches the market between fixture groups; refused while a run is in flight. */
  setMarket(market: SyntheticMarket): void {
    if (this.active.size > 0) throw new Error('cannot switch the eval market while runs are in flight');
    this.reader.setMarket(market);
  }

  beginRun(input: {
    requestId: string;
    threadId: string;
    context: Pick<PortfolioAssistantContext, 'positions' | 'source' | 'underlying' | 'generatedAt'>;
  }): { portfolioRef: string } {
    const accountId = `assistant-eval:${input.requestId}`;
    this.books.set(accountId, heldBookForContext(input.context, this.reader.market, accountId));
    const portfolioRef = this.refs.mint({
      accountId,
      source: input.context.source,
      underlying: input.context.underlying,
      generatedAt: input.context.generatedAt,
    });
    this.runs.begin({
      requestId: input.requestId,
      userIdHash: EVAL_USER_ID_HASH,
      threadId: input.threadId,
      portfolioRef,
    });
    this.active.set(input.requestId, { accountId, startedAt: this.now(), calls: [] });
    return { portfolioRef };
  }

  finishRun(requestId: string): EvalRunToolUsage {
    const summary = this.runs.finish(requestId) ?? emptyAssistantRunToolSummary();
    const state = this.active.get(requestId);
    this.active.delete(requestId);
    if (state == null) return { summary, calls: [], unattributedDuringRun: 0 };
    this.books.delete(state.accountId);
    const finishedAt = this.now();
    return {
      summary,
      calls: state.calls,
      unattributedDuringRun: this.unattributedAt.filter(
        (at) => at >= state.startedAt && at <= finishedAt,
      ).length,
    };
  }

  async listen(token: string, port: number): Promise<void> {
    if (this.server != null) return;
    this.server = await startAssistantMcpServer({ token, port, log: this.log, handler: this.handler });
  }

  async close(): Promise<void> {
    await this.server?.close();
    this.server = null;
  }

  private record(record: AssistantToolCallRecord): void {
    const { attribution } = record;
    if (attribution.mode === 'exact' || attribution.mode === 'single_active') {
      this.active.get(attribution.requestId)?.calls.push({
        tool: record.tool,
        outcome: record.outcome,
        attribution: attribution.mode,
      });
      return;
    }
    this.unattributedAt.push(this.now());
  }
}
