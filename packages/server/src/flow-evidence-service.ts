import {
  analyzeBlockTrade,
  analyzeFlowTrade,
  buildBlockTradeUid,
  buildLiveTradeUid,
  flowExecutionGroup,
  flowPositionEffect,
  getVenueContractMultiplier,
  reconcileFlowPosition,
  parseTradeInstrument,
  type BlockTradeEvent,
  type TradeEvent,
} from '@oggregator/core';
import type { OiSnapshotStore, OiSnapshotWindow, TradeHistoryReader } from '@oggregator/db';
import type { FlowAnalysis, FlowEvidenceResponse, FlowOiContext, FlowOiTick } from '@oggregator/protocol';
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
  fastOi?: { bracket: (venue: string, instrument: string, timestamp: number) => { before: FlowOiTick | null; after: FlowOiTick | null } };
  trades: TradeHistoryReader;
  oi: Pick<OiSnapshotStore, 'enabled' | 'loadWindow'> & Partial<OiSnapshotStore>;
  live: (underlying: string) => TradeEvent[];
  blocks: (underlying: string) => BlockTradeEvent[];
  log?: { warn: (fields: object, message: string) => void };
}

const QUARTER_HOUR = 15 * 60_000;
const GROUP_LIMIT = 2_000;

export class FlowEvidenceService {
  private readonly oiBatches = new Map<string, {
    instruments: Set<string>;
    requests: Array<{ resolve: (window: OiSnapshotWindow) => void; reject: (error: unknown) => void }>;
  }>();
  private readonly tapes = new Map<string, { expires: number; value: Promise<{ trades: TradeEvent[]; truncated: boolean }> }>();
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
    const oi = instruments.map((instrument, index) =>
        oiContext(instrument, symbols[index] ?? null, trade.timestamp, window),
    );
    const multiplier = getVenueContractMultiplier(trade.venue, trade.underlying);
    for (const context of oi) {
      if (context.before) context.before.openInterest *= multiplier;
      if (context.after) context.after.openInterest *= multiplier;
      if (context.delta != null) context.delta *= multiplier;
      if (trade.venue === 'deribit' && !['BTC', 'ETH'].includes(trade.underlying)) {
        context.status = 'unavailable';
        context.delta = null;
      }
      const fast = this.options.fastOi?.bracket(trade.venue, context.instrument, trade.timestamp);
      if (fast?.before && fast.after) {
        const intervalMs = fast.after.timestamp - fast.before.timestamp;
        if (intervalMs <= 25 * 60_000 && (context.status !== 'bracketed' || intervalMs < (context.intervalMs ?? Infinity))) {
          Object.assign(context, {
            before: { timestamp: fast.before.timestamp, openInterest: fast.before.openInterest },
            after: { timestamp: fast.after.timestamp, openInterest: fast.after.openInterest },
            delta: fast.after.openInterest - fast.before.openInterest,
            intervalMs, timing: 'exchange', status: 'bracketed',
          });
        }
      } else if (fast?.before && !context.before && trade.timestamp > Date.now() - 30 * 60_000) {
        Object.assign(context, { before: { timestamp: fast.before.timestamp, openInterest: fast.before.openInterest }, status: 'pending', timing: 'exchange' });
      }
    }
    const target = trade;
    const legs = await Promise.all(analysis.legs.map(async (leg) => {
      const context = oi.find((item) => item.instrument === leg.instrument);
      if (!context) return leg;
      let prints: TradeEvent[] = [];
      let coverage: 'recorded' | 'sequence_contiguous' | 'gap' | 'truncated' | 'unavailable' = 'unavailable';
      if (context.before && context.after && context.status === 'bracketed') {
        try {
          const tape = await this.loadTape(target, leg.instrument, context.before.timestamp, context.after.timestamp);
          prints = tape.trades;
          coverage = tape.truncated ? 'truncated' : this.options.trades.enabled ? 'recorded' : 'unavailable';
          if (coverage === 'recorded' && target.venue === 'deribit' && prints.length > 1) {
            const sequences = prints.map((print) => Number(print.exchangeEvidence?.tradeSequence));
            if (sequences.every((sequence) => Number.isSafeInteger(sequence) && sequence > 0)) {
              sequences.sort((a, b) => a - b);
              coverage = sequences.every((sequence, index) => index === 0 || sequence === sequences[index - 1]! + 1)
                ? 'sequence_contiguous' : 'gap';
            }
          }
        } catch (error: unknown) {
          this.options.log?.warn({ err: String(error), venue: target.venue }, 'flow reconciliation tape unavailable');
        }
      }
      const matches = prints.filter((print) => {
        if (print.side !== leg.side) return false;
        if (!('legs' in target) && buildLiveTradeUid(print) === buildLiveTradeUid(target)) return true;
        const group = flowExecutionGroup(target.exchangeEvidence);
        if (group && group === flowExecutionGroup(print.exchangeEvidence)) return true;
        return 'legs' in target && target.exchangeEvidence?.rfqId != null &&
          target.exchangeEvidence.rfqId === print.exchangeEvidence?.rfqId && print.timestamp === target.timestamp;
      });
      const matchedVolume = matches.reduce((sum, print) => sum + print.size * multiplier, 0);
      context.tradeCoverage = coverage;
      return {
        ...leg,
        position: reconcileFlowPosition(leg, context, {
          volume: prints.reduce((sum, print) => sum + print.size * multiplier, 0),
          count: prints.length,
          targetPresent: Math.abs(matchedVolume - leg.quantity) <= 1e-8 * Math.max(1, leg.quantity),
          coverage,
        }),
      };
    }));
    return {
      analysis: { ...analysis, legs, positionEffect: flowPositionEffect(legs) },
      evidence: trade.exchangeEvidence ?? null,
      oi,
    };
  }

  private loadTape(target: TradeEvent | BlockTradeEvent, instrument: string, from: number, to: number) {
    const key = JSON.stringify([target.venue, instrument, from, to]);
    const cached = this.tapes.get(key);
    if (cached && cached.expires > Date.now()) return cached.value;
    const value = (async () => {
      const found = new Map<string, TradeEvent>();
      let truncated = false;
      if (this.options.trades.enabled) {
        let beforeTs: Date | undefined;
        let beforeUid: string | undefined;
        for (let page = 0; page < 10; page++) {
          const rows = await this.options.trades.loadHistory({
            mode: 'live', venues: [target.venue], instrumentName: instrument,
            startTs: new Date(from + 1), endTs: new Date(to + 1), limit: GROUP_LIMIT,
            ...(beforeTs ? { beforeTs } : {}), ...(beforeUid ? { beforeUid } : {}),
          });
          for (const row of rows) {
            const print = storedFlowTrade(row);
            if (print) found.set(buildLiveTradeUid(print), print);
          }
          if (rows.length < GROUP_LIMIT) break;
          const last = rows.at(-1)!;
          beforeTs = last.tradeTs;
          beforeUid = last.tradeUid;
          if (page === 9) truncated = true;
        }
      }
      for (const print of this.options.live(target.underlying)) {
        if (print.venue === target.venue && print.instrument === instrument && print.timestamp > from && print.timestamp <= to)
          found.set(buildLiveTradeUid(print), print);
      }
      return { trades: [...found.values()], truncated };
    })();
    this.tapes.set(key, { expires: Date.now() + 30_000, value });
    if (this.tapes.size > 256) this.tapes.delete(this.tapes.keys().next().value!);
    void value.catch(() => this.tapes.delete(key));
    return value;
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
    const batchKey = `${venue}:${bucket}`;
    const value = new Promise<OiSnapshotWindow>((resolve, reject) => {
      const pending = this.oiBatches.get(batchKey);
      if (pending) {
        for (const instrument of instruments) pending.instruments.add(instrument);
        pending.requests.push({ resolve, reject });
        return;
      }
      const batch = { instruments: new Set(instruments), requests: [{ resolve, reject }] };
      this.oiBatches.set(batchKey, batch);
      setTimeout(() => {
        this.oiBatches.delete(batchKey);
        void this.options.oi.loadWindow({
          venue, instruments: [...batch.instruments],
          from: new Date(bucket - 3 * QUARTER_HOUR), to: new Date(bucket + 4 * QUARTER_HOUR),
        }).then(
          (window) => { for (const request of batch.requests) request.resolve(window); },
          (error: unknown) => { for (const request of batch.requests) request.reject(error); },
        );
      }, 25);
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
  const beforeRow = [...samples].reverse().find((row) => row.snapshotTs.getTime() < timestamp);
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
