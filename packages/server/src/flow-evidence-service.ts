import {
  analyzeBlockTrade,
  analyzeFlowTrade,
  buildBlockTradeUid,
  buildLiveTradeUid,
  flowExecutionGroup,
  parseTradeInstrument,
  type BlockTradeEvent,
  type TradeEvent,
} from '@oggregator/core';
import type { OiSnapshotStore, OiSnapshotWindow, TradeHistoryReader } from '@oggregator/db';
import type { FlowAnalysis, FlowEvidenceResponse, FlowOiContext } from '@oggregator/protocol';
import { storedBlockTrade, storedFlowTrade } from './flow-records.js';

export interface FlowEvidenceQuery {
  mode: 'live' | 'institutional';
  tradeUid: string;
  venue: string;
  underlying: string;
  instrument: string;
  timestamp: number;
}

interface Options {
  trades: TradeHistoryReader;
  oi: OiSnapshotStore;
  live: (underlying: string) => TradeEvent[];
  blocks: (underlying: string) => BlockTradeEvent[];
  log?: { warn: (fields: object, message: string) => void };
}

const QUARTER_HOUR = 15 * 60_000;
const GROUP_LIMIT = 2_000;

export class FlowEvidenceService {
  private readonly windows = new Map<
    string,
    { expires: number; value: Promise<OiSnapshotWindow> }
  >();

  constructor(private readonly options: Options) {}

  async get(query: FlowEvidenceQuery): Promise<FlowEvidenceResponse | null> {
    let trade: TradeEvent | BlockTradeEvent | undefined;
    if (query.mode === 'live') {
      trade = this.options
        .live(query.underlying)
        .find(
          (item) =>
            item.venue === query.venue &&
            item.timestamp === query.timestamp &&
            buildLiveTradeUid(item) === query.tradeUid,
        );
    } else {
      trade = this.options
        .blocks(query.underlying)
        .find(
          (item) =>
            item.venue === query.venue &&
            item.timestamp === query.timestamp &&
            buildBlockTradeUid(item) === query.tradeUid,
        );
    }
    if (!trade && this.options.trades.enabled) {
      const rows = await this.options.trades.loadHistory({
        mode: query.mode,
        venues: [query.venue],
        instrumentName: query.instrument,
        startTs: new Date(query.timestamp),
        endTs: new Date(query.timestamp + 1),
        limit: 100,
      });
      const row = rows.find((item) => item.tradeUid === query.tradeUid);
      if (row)
        trade = (query.mode === 'live' ? storedFlowTrade(row) : storedBlockTrade(row)) ?? undefined;
    }
    if (!trade) return null;
    let analysis: FlowAnalysis;
    if ('legs' in trade) {
      analysis = analyzeBlockTrade(trade);
    } else {
      const peers = [...this.options.live(trade.underlying)];
      if (flowExecutionGroup(trade.exchangeEvidence) != null && this.options.trades.enabled) {
        const rows = await this.options.trades.loadHistory({
          mode: 'live',
          venues: [trade.venue],
          startTs: new Date(trade.timestamp - 2_000),
          endTs: new Date(trade.timestamp + 2_001),
          limit: GROUP_LIMIT,
        });
        for (const row of rows) {
          const peer = storedFlowTrade(row);
          if (peer) peers.push(peer);
        }
        if (rows.length === GROUP_LIMIT)
          trade = {
            ...trade,
            exchangeEvidence: { ...trade.exchangeEvidence, groupComplete: false },
          };
      }
      analysis = analyzeFlowTrade(trade, peers);
    }
    const instruments = [...new Set(analysis.legs.map((leg) => leg.instrument))].slice(0, 16);
    const symbols = instruments.map((instrument) =>
      flowOiSymbol(trade.venue, trade.underlying, instrument),
    );
    let window: OiSnapshotWindow = { rows: [], complete: false };
    if (this.options.oi.enabled && symbols.some((symbol) => symbol != null)) {
      window = await this.loadOi(
        trade.venue,
        symbols.filter((s): s is string => s != null),
        trade.timestamp,
      ).catch((error: unknown) => {
        this.options.log?.warn(
          { err: String(error), venue: trade.venue },
          'flow OI context unavailable',
        );
        return { rows: [], complete: false };
      });
    }
    return {
      analysis,
      evidence: trade.exchangeEvidence ?? null,
      oi: instruments.map((instrument, index) =>
        oiContext(instrument, symbols[index] ?? null, trade.timestamp, window),
      ),
    };
  }

  private loadOi(
    venue: string,
    instruments: string[],
    timestamp: number,
  ): Promise<OiSnapshotWindow> {
    const bucket = Math.floor(timestamp / QUARTER_HOUR) * QUARTER_HOUR;
    const key = JSON.stringify([venue, [...instruments].sort(), bucket]);
    const cached = this.windows.get(key);
    if (cached && cached.expires > Date.now()) return cached.value;
    const value = this.options.oi.loadWindow({
      venue,
      instruments,
      from: new Date(bucket - 3 * QUARTER_HOUR),
      to: new Date(bucket + 4 * QUARTER_HOUR),
    });
    this.windows.set(key, { expires: Date.now() + 60_000, value });
    if (this.windows.size > 128) this.windows.delete(this.windows.keys().next().value!);
    void value.catch(() => this.windows.delete(key));
    return value;
  }
}

export function flowOiSymbol(venue: string, underlying: string, instrument: string): string | null {
  const prefix = instrument.split('-')[0]?.split(/[_/]/)[0] ?? '';
  const base =
    venue === 'coincall'
      ? prefix.replace(/USD[TC]?$/, '')
      : venue === 'gateio' && prefix === 'CL'
        ? 'XTI'
        : prefix;
  if (base !== underlying) return null;
  const parts = parseTradeInstrument(instrument);
  if (parts.expiry == null || parts.strike == null || parts.optionType == null) return null;
  const settlements: Record<string, string> = {
    okx: underlying,
    bybit: instrument.match(/-(USDC|USDT)$/)?.[1] ?? 'USDT',
    binance: 'USDT',
    derive: 'USDC',
    thalex: 'USD',
    coincall: 'USD',
    gateio: 'USDT',
    paradex: 'USDC',
    deribit: instrument.split('-')[0]?.split('_')[1] ?? underlying,
  };
  const settle = settlements[venue];
  if (!settle) return null;
  return `${underlying}/USD:${settle}-${parts.expiry.replaceAll('-', '').slice(2)}-${parts.strike}-${parts.optionType === 'call' ? 'C' : 'P'}`;
}

export function oiContext(
  instrument: string,
  symbol: string | null,
  timestamp: number,
  window: OiSnapshotWindow,
): FlowOiContext {
  const samples = window.rows
    .filter((row) => row.instrumentName === symbol)
    .sort((a, b) => a.snapshotTs.getTime() - b.snapshotTs.getTime());
  const beforeRow = [...samples].reverse().find((row) => row.snapshotTs.getTime() <= timestamp);
  const afterRow = samples.find((row) => row.snapshotTs.getTime() > timestamp);
  const before = beforeRow
    ? { timestamp: beforeRow.snapshotTs.getTime(), openInterest: beforeRow.openInterest }
    : null;
  const after = afterRow
    ? { timestamp: afterRow.snapshotTs.getTime(), openInterest: afterRow.openInterest }
    : null;
  const intervalMs = before && after ? after.timestamp - before.timestamp : null;
  return {
    instrument,
    status:
      !window.complete || !symbol
        ? 'unavailable'
        : before && after
          ? intervalMs! <= 25 * 60_000
            ? 'bracketed'
            : 'gap'
          : before && timestamp > Date.now() - 2 * QUARTER_HOUR
            ? 'pending'
            : 'unavailable',
    before,
    after,
    intervalMs,
    delta: window.complete && before && after ? after.openInterest - before.openInterest : null,
    timing: 'sampled',
    tradeCoverage: 'unverified',
  };
}
