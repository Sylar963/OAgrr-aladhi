import type { OptionsParityRow } from '@oggregator/protocol';

export interface ParityQuote {
  bid: number | null;
  ask: number | null;
  bidSize: number | null;
  askSize: number | null;
  bidTime: number | null;
  askTime: number | null;
  receivedAt: number | null;
}

export interface OptionsParityInput {
  root: string;
  expiryTs: number;
  settlement: string;
  strike: number;
  multiplier: number;
  right: 'call' | 'put';
  quote: ParityQuote | null;
}

export const PARITY_MAX_QUOTE_AGE_MS = 20 * 60_000;
export const PARITY_MAX_QUOTE_SKEW_MS = 30_000;
export const PARITY_MAX_RECEIPT_AGE_MS = 120_000;

function validQuote(q: ParityQuote): boolean {
  return (
    [q.bid, q.ask, q.bidSize, q.askSize].every((v) => v != null && Number.isFinite(v) && v >= 0) &&
    q.ask! >= q.bid! &&
    q.bidSize! > 0 &&
    q.askSize! > 0
  );
}

function pairRow(
  input: OptionsParityInput,
  call: ParityQuote | null,
  put: ParityQuote | null,
  now: number,
): OptionsParityRow {
  const row: OptionsParityRow = {
    root: input.root,
    strike: input.strike,
    multiplier: input.multiplier,
    status: 'missing_pair',
    callMinusPutBid: null,
    callMinusPutAsk: null,
    zeroRateForward: null,
    quoteAgeMs: null,
    quoteSkewMs: null,
    bidSize: null,
    askSize: null,
    referenceStrikes: null,
    consistencyResidual: null,
    consistencyLow: null,
    consistencyHigh: null,
  };
  if (call == null || put == null) return row;
  if (!validQuote(call) || !validQuote(put)) return { ...row, status: 'invalid_quote' };
  const times = [call.bidTime, call.askTime, put.bidTime, put.askTime];
  if (
    times.some((t) => t == null || !Number.isFinite(t) || t <= 0 || t > now + 1_000) ||
    call.receivedAt == null ||
    put.receivedAt == null
  )
    return { ...row, status: 'missing_time' };
  const sourceTimes = times as number[];
  row.quoteAgeMs = Math.max(0, now - Math.min(...sourceTimes));
  row.quoteSkewMs = Math.max(...sourceTimes) - Math.min(...sourceTimes);
  if (
    row.quoteAgeMs > PARITY_MAX_QUOTE_AGE_MS ||
    now - Math.min(call.receivedAt, put.receivedAt) > PARITY_MAX_RECEIPT_AGE_MS
  ) {
    return { ...row, status: 'stale' };
  }
  if (row.quoteSkewMs > PARITY_MAX_QUOTE_SKEW_MS) return { ...row, status: 'unsynchronized' };
  row.status = 'ok';
  row.callMinusPutBid = call.bid! - put.ask!;
  row.callMinusPutAsk = call.ask! - put.bid!;
  row.zeroRateForward = input.strike + (row.callMinusPutBid + row.callMinusPutAsk) / 2;
  row.bidSize = Math.min(call.bidSize!, put.askSize!);
  row.askSize = Math.min(call.askSize!, put.bidSize!);
  return row;
}

export function computeOptionsParity(
  inputs: readonly OptionsParityInput[],
  now: number,
  europeanConsistency: boolean,
): OptionsParityRow[] {
  const groups = new Map<
    string,
    Map<
      number,
      {
        input: OptionsParityInput;
        call: ParityQuote | null;
        put: ParityQuote | null;
        duplicate: boolean;
      }
    >
  >();
  for (const input of inputs) {
    const key = `${input.root}:${input.expiryTs}:${input.settlement}:${input.multiplier}`;
    const group = groups.get(key) ?? new Map();
    groups.set(key, group);
    const pair = group.get(input.strike) ?? { input, call: null, put: null, duplicate: false };
    if (pair[input.right] != null) pair.duplicate = true;
    pair[input.right] = input.quote;
    group.set(input.strike, pair);
  }
  const result: OptionsParityRow[] = [];
  for (const group of groups.values()) {
    const rows = [...group.values()]
      .sort((a, b) => a.input.strike - b.input.strike)
      .map(({ input, call, put, duplicate }) => pairRow(input, duplicate ? null : call, put, now));
    if (europeanConsistency) {
      const eligible = rows.filter((r) => r.status === 'ok');
      for (let i = 1; i < eligible.length - 1; i++) {
        const row = eligible[i]!;
        const left = eligible[i - 1]!;
        const right = eligible[i + 1]!;
        const oldest = Math.max(left.quoteAgeMs!, row.quoteAgeMs!, right.quoteAgeMs!);
        const newest = Math.min(
          left.quoteAgeMs! - left.quoteSkewMs!,
          row.quoteAgeMs! - row.quoteSkewMs!,
          right.quoteAgeMs! - right.quoteSkewMs!,
        );
        if (oldest - newest > PARITY_MAX_QUOTE_SKEW_MS) continue;
        const weight = (row.strike - left.strike) / (right.strike - left.strike);
        const interpolate = (a: number, b: number) => a + weight * (b - a);
        const low = interpolate(left.callMinusPutBid!, right.callMinusPutBid!);
        const high = interpolate(left.callMinusPutAsk!, right.callMinusPutAsk!);
        row.referenceStrikes = [left.strike, right.strike];
        row.consistencyResidual = (row.callMinusPutBid! + row.callMinusPutAsk! - low - high) / 2;
        row.consistencyLow = row.callMinusPutBid! - high;
        row.consistencyHigh = row.callMinusPutAsk! - low;
      }
    }
    result.push(...rows);
  }
  return result.sort((a, b) => a.strike - b.strike || a.root.localeCompare(b.root));
}
