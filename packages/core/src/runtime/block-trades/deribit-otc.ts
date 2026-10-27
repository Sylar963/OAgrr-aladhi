import { z } from 'zod';
import {
  DERIBIT_GET_LAST_TRADES_BY_CURRENCY,
  DERIBIT_REST_BASE_URL,
} from '../../feeds/shared/endpoints.js';
import { computeBlockTradeAmounts } from '../../trade-persistence.js';
import { feedLogger } from '../../utils/logger.js';
import { deriveStrategy, extractUnderlying, isOptionInstrument } from './instruments.js';
import type { BlockTradeEvent, BlockTradeLeg } from './types.js';

// Deribit blocks executed through private/execute_block_trade (Paradigm, bilateral OTC) print on
// the public option tape with a block_trade_id. Block RFQ fills carry block_rfq_id too and already
// arrive on block_rfq.trades.any, so those are skipped here.

const log = feedLogger('block-trade-runtime');

export const DERIBIT_OTC_TAPE_CHANNEL = 'trades.option.any.100ms';
// USDC holds the linear options (SOL_USDC, BTC_USDC, ...).
const DERIBIT_OTC_SEED_CURRENCIES = ['BTC', 'ETH', 'USDC'] as const;
const DERIBIT_OTC_SEED_PAGE_SIZE = 1_000;
// Legs of one block share a matching-engine timestamp and normally land in the same 100ms frame.
// The grace window covers a split frame and blocks whose futures hedge legs never reach this channel.
const DERIBIT_OTC_LEG_GRACE_MS = 2_000;
const AMOUNT_SCALE = 10_000;
const MAX_LEG_RATIO = 20;

const DeribitTapeLegSchema = z.object({
  trade_id: z.union([z.string(), z.number()]).transform(String),
  instrument_name: z.string(),
  direction: z.enum(['buy', 'sell']),
  price: z.number(),
  amount: z.number().positive(),
  index_price: z.number().optional(),
  timestamp: z.number(),
  block_trade_id: z.string().min(1),
  block_trade_leg_count: z.number().int().positive().optional(),
  combo_id: z.string().nullable().optional(),
});

export type DeribitTapeLeg = z.infer<typeof DeribitTapeLegSchema>;

const DeribitLastTradesResponseSchema = z.object({
  result: z.object({ trades: z.array(z.unknown()) }).optional(),
});

export function parseDeribitOtcLegs(items: unknown[]): DeribitTapeLeg[] {
  const legs: DeribitTapeLeg[] = [];
  for (const item of items) {
    if (item == null || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    // Cheap pre-filter: the tape is mostly screen fills.
    if (raw['block_trade_id'] == null || raw['block_rfq_id'] != null) continue;
    const parsed = DeribitTapeLegSchema.safeParse(raw);
    if (parsed.success) legs.push(parsed.data);
  }
  return legs;
}

export function mapDeribitOtcBlock(legs: DeribitTapeLeg[]): BlockTradeEvent | null {
  const optionLegs = legs
    .filter((leg) => isOptionInstrument(leg.instrument_name))
    .sort((left, right) => Number(left.trade_id) - Number(right.trade_id));
  const first = optionLegs[0];
  if (!first) return null;

  const indexPrice = optionLegs.find((leg) => leg.index_price != null)?.index_price ?? null;
  const sizing = legSizing(optionLegs.map((leg) => leg.amount));

  const block: BlockTradeEvent = {
    venue: 'deribit',
    source: 'otc',
    tradeId: first.block_trade_id,
    exchangeEvidence: {
      blockTradeId: first.block_trade_id,
      ...(first.combo_id ? { comboId: first.combo_id } : {}),
      ...(first.block_trade_leg_count != null ? {
        expectedLegCount: first.block_trade_leg_count,
        groupComplete: optionLegs.length === first.block_trade_leg_count,
      } : {}),
    },
    timestamp: first.timestamp,
    underlying: extractUnderlying(first.instrument_name),
    direction: netPremiumDirection(optionLegs),
    strategy: deriveStrategy(first.combo_id, optionLegs.length),
    legs: optionLegs.map(
      (leg, index): BlockTradeLeg => ({
        instrument: leg.instrument_name,
        direction: leg.direction,
        price: toUsdPrice(leg, indexPrice),
        size: sizing.legSizes[index]!,
        ratio: sizing.ratios[index]!,
      }),
    ),
    totalSize: sizing.totalSize,
    notionalUsd: 0,
    indexPrice,
  };

  block.notionalUsd = computeBlockTradeAmounts(block, indexPrice).notionalUsd ?? 0;
  return block;
}

/** Groups tape legs by block id; emits complete blocks at once and partial ones after a grace window. */
export class DeribitOtcBlockAssembler {
  private readonly pending = new Map<
    string,
    { legs: DeribitTapeLeg[]; timer: ReturnType<typeof setTimeout> }
  >();

  constructor(
    private readonly emit: (trades: BlockTradeEvent[]) => void,
    private readonly graceMs = DERIBIT_OTC_LEG_GRACE_MS,
  ) {}

  push(legs: DeribitTapeLeg[]): BlockTradeEvent[] {
    const completed: BlockTradeEvent[] = [];
    for (const leg of legs) {
      const blockId = leg.block_trade_id;
      let entry = this.pending.get(blockId);
      if (!entry) {
        entry = { legs: [], timer: setTimeout(() => this.flush(blockId), this.graceMs) };
        this.pending.set(blockId, entry);
      }
      if (entry.legs.some((existing) => existing.trade_id === leg.trade_id)) continue;
      entry.legs.push(leg);

      if (leg.block_trade_leg_count != null && entry.legs.length >= leg.block_trade_leg_count) {
        clearTimeout(entry.timer);
        this.pending.delete(blockId);
        const block = mapDeribitOtcBlock(entry.legs);
        if (block) completed.push(block);
      }
    }
    return completed;
  }

  dispose(): void {
    for (const entry of this.pending.values()) clearTimeout(entry.timer);
    this.pending.clear();
  }

  private flush(blockId: string): void {
    const entry = this.pending.get(blockId);
    if (!entry) return;
    this.pending.delete(blockId);
    const block = mapDeribitOtcBlock(entry.legs);
    if (block) this.emit([block]);
  }
}

/** Groups a REST page; drops a partial block at the page's oldest edge since its legs may be cut off. */
export function groupDeribitOtcPage(legs: DeribitTapeLeg[]): BlockTradeEvent[] {
  const groups = new Map<string, DeribitTapeLeg[]>();
  for (const leg of legs) {
    const group = groups.get(leg.block_trade_id);
    if (group) group.push(leg);
    else groups.set(leg.block_trade_id, [leg]);
  }

  const oldestTimestamp = Math.min(...legs.map((leg) => leg.timestamp));
  const blocks: BlockTradeEvent[] = [];
  for (const group of groups.values()) {
    const first = group[0]!;
    const isComplete = group.length >= (first.block_trade_leg_count ?? 1);
    if (!isComplete && first.timestamp === oldestTimestamp) continue;
    const block = mapDeribitOtcBlock(group);
    if (block) blocks.push(block);
  }
  return blocks;
}

export async function fetchDeribitOtcSeed(
  fetchJson: (url: string) => Promise<unknown>,
): Promise<BlockTradeEvent[]> {
  const pages = await Promise.all(
    DERIBIT_OTC_SEED_CURRENCIES.map(async (currency) => {
      const params = new URLSearchParams({
        currency,
        kind: 'option',
        count: String(DERIBIT_OTC_SEED_PAGE_SIZE),
      });
      try {
        const json = await fetchJson(
          `${DERIBIT_REST_BASE_URL}${DERIBIT_GET_LAST_TRADES_BY_CURRENCY}?${params}`,
        );
        const parsed = DeribitLastTradesResponseSchema.safeParse(json);
        if (!parsed.success) return [];
        return groupDeribitOtcPage(parseDeribitOtcLegs(parsed.data.result?.trades ?? []));
      } catch (err) {
        log.warn({ venue: 'deribit', currency, err: String(err) }, 'otc block seed failed');
        return [];
      }
    }),
  );
  return pages.flat();
}

// Debit for the initiator reads as a buy (long fly, long calendar, bullish risk reversal).
function netPremiumDirection(legs: DeribitTapeLeg[]): 'buy' | 'sell' {
  const debit = legs.reduce(
    (sum, leg) => sum + (leg.direction === 'buy' ? 1 : -1) * leg.price * leg.amount,
    0,
  );
  if (debit > 0) return 'buy';
  if (debit < 0) return 'sell';
  return legs[0]!.direction;
}

// Inverse options quote in coin; linear USDC options (SOL_USDC-...) already quote in USD.
function toUsdPrice(leg: DeribitTapeLeg, indexPrice: number | null): number {
  const isLinear = leg.instrument_name.split('-')[0]!.includes('_');
  if (isLinear || indexPrice == null) return leg.price;
  return leg.price * indexPrice;
}

// Matches the Block RFQ shape: one block unit with integer leg ratios (250/500/250 → 250 × 1:2:1).
function legSizing(amounts: number[]): { totalSize: number; legSizes: number[]; ratios: number[] } {
  const scaled = amounts.map((amount) => Math.round(amount * AMOUNT_SCALE));
  const divisor = scaled.reduce((acc, value) => gcd(acc, value));
  const ratios = scaled.map((value) => value / divisor);
  if (divisor > 0 && Math.max(...ratios) <= MAX_LEG_RATIO) {
    const unit = divisor / AMOUNT_SCALE;
    return { totalSize: unit, legSizes: amounts.map(() => unit), ratios };
  }
  return { totalSize: Math.max(...amounts), legSizes: amounts, ratios: amounts.map(() => 1) };
}

function gcd(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b > 0) [a, b] = [b, a % b];
  return a;
}
