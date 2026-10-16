import type WebSocket from 'ws';
import type { ParadexSummary, ParadexSummaryValues } from './types.js';

const HEADER_LENGTH = 8;
const MARKET_SUMMARY_TEMPLATE_ID = 4;
const PARADEX_SCHEMA_ID = 1;
const VERSION_ZERO_BLOCK_LENGTH = 216;
const VERSION_ONE_BLOCK_LENGTH = 240;
const NULL_INT64 = -(1n << 63n);

/** Returned for a well-formed summary frame whose market the caller does not track. */
export const PARADEX_SBE_IGNORED = Symbol('paradex-sbe-ignored');

function asBuffer(raw: WebSocket.RawData): Buffer {
  if (Buffer.isBuffer(raw)) return raw;
  if (Array.isArray(raw)) return Buffer.concat(raw);
  return Buffer.from(raw);
}

function decimalString(value: bigint, scale: number): string | null {
  if (value === NULL_INT64) return null;

  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const divisor = 10n ** BigInt(scale);
  const whole = magnitude / divisor;
  const fraction = (magnitude % divisor).toString().padStart(scale, '0').replace(/0+$/, '');
  const unsigned = fraction.length > 0 ? `${whole}.${fraction}` : whole.toString();
  return negative ? `-${unsigned}` : unsigned;
}

function optionalDecimal(buffer: Buffer, bodyOffset: number, scale = 8): string | null {
  return decimalString(buffer.readBigInt64LE(HEADER_LENGTH + bodyOffset), scale);
}

const TWO_POW_32 = 4_294_967_296;
// int64 values whose high word lies in [-2^21, 2^21) are exact doubles (|v| < 2^53).
const EXACT_HIGH_WORD = 2_097_152;
const POW10 = [1, 10, 1e2, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12];

// Same value Number(decimalString(v, scale)) would produce, without BigInt or strings: an
// exact integer divided by an exact power of ten is correctly rounded, like parsing the exact
// decimal. Values outside the exact range take the string path so results never differ.
function optionalNumber(buffer: Buffer, bodyOffset: number, scale = 8): number | null {
  const offset = HEADER_LENGTH + bodyOffset;
  const low = buffer.readUInt32LE(offset);
  const high = buffer.readInt32LE(offset + 4);
  if (high === -2_147_483_648 && low === 0) return null;
  if (high >= -EXACT_HIGH_WORD && high < EXACT_HIGH_WORD) {
    return (high * TWO_POW_32 + low) / POW10[scale]!;
  }
  const exact = optionalDecimal(buffer, bodyOffset, scale);
  return exact === null ? null : Number(exact);
}

function requiredDecimal(buffer: Buffer, bodyOffset: number, scale = 8): string {
  return optionalDecimal(buffer, bodyOffset, scale) ?? '';
}

interface SummaryFrame {
  buffer: Buffer;
  symbol: string;
  blockLength: number;
  version: number;
}

// The binary layout is the validation boundary for these frames; the result is already typed.
// `accept` runs on the symbol before any decimal is decoded, since the feed also carries
// perps and untracked markets.
function readSummaryFrame(
  raw: WebSocket.RawData,
  accept?: (symbol: string) => boolean,
): SummaryFrame | typeof PARADEX_SBE_IGNORED | null {
  const buffer = asBuffer(raw);
  if (buffer.length < HEADER_LENGTH) return null;

  const blockLength = buffer.readUInt16LE(0);
  const templateId = buffer.readUInt16LE(2);
  const schemaId = buffer.readUInt16LE(4);
  const version = buffer.readUInt16LE(6);

  if (templateId !== MARKET_SUMMARY_TEMPLATE_ID || schemaId !== PARADEX_SCHEMA_ID) return null;
  if (blockLength < VERSION_ZERO_BLOCK_LENGTH) return null;

  const marketLengthOffset = HEADER_LENGTH + blockLength;
  if (buffer.length <= marketLengthOffset) return null;

  const marketLength = buffer.readUInt8(marketLengthOffset);
  const marketStart = marketLengthOffset + 1;
  const marketEnd = marketStart + marketLength;
  if (buffer.length < marketEnd) return null;

  const symbol = buffer.subarray(marketStart, marketEnd).toString('utf8');
  if (symbol.length === 0) return null;
  if (accept != null && !accept(symbol)) return PARADEX_SBE_IGNORED;
  return { buffer, symbol, blockLength, version };
}

function createdAtMs(buffer: Buffer): number {
  return Number(buffer.readBigInt64LE(HEADER_LENGTH) / 1_000n);
}

function hasPreciseFunding(frame: SummaryFrame): boolean {
  return frame.version >= 1 && frame.blockLength >= VERSION_ONE_BLOCK_LENGTH;
}

export function decodeParadexMarketSummarySbe(
  raw: WebSocket.RawData,
  accept?: (symbol: string) => boolean,
): ParadexSummary | typeof PARADEX_SBE_IGNORED | null {
  const frame = readSummaryFrame(raw, accept);
  if (frame === null || frame === PARADEX_SBE_IGNORED) return frame;
  const { buffer, symbol } = frame;
  const fundingRatePrecise = hasPreciseFunding(frame) ? optionalDecimal(buffer, 232, 12) : null;

  return {
    symbol,
    mark_price: requiredDecimal(buffer, 16),
    underlying_price: requiredDecimal(buffer, 24),
    last_traded_price: requiredDecimal(buffer, 32),
    volume_24h: requiredDecimal(buffer, 40),
    open_interest: requiredDecimal(buffer, 48),
    funding_rate: fundingRatePrecise ?? requiredDecimal(buffer, 56),
    bid: optionalDecimal(buffer, 64),
    ask: optionalDecimal(buffer, 72),
    mark_iv: optionalDecimal(buffer, 96),
    bid_iv: optionalDecimal(buffer, 104),
    ask_iv: optionalDecimal(buffer, 112),
    bid_size: optionalDecimal(buffer, 200),
    ask_size: optionalDecimal(buffer, 208),
    greeks: {
      delta: optionalDecimal(buffer, 128),
      gamma: optionalDecimal(buffer, 136),
      vega: optionalDecimal(buffer, 144),
      theta: optionalDecimal(buffer, 152),
      rho: optionalDecimal(buffer, 160),
      volga: optionalDecimal(buffer, 168),
      vanna: optionalDecimal(buffer, 176),
    },
    created_at: createdAtMs(buffer),
  };
}

/** Numeric twin of {@link decodeParadexMarketSummarySbe} for the live quote path. */
export function decodeParadexMarketSummaryValues(
  raw: WebSocket.RawData,
  accept?: (symbol: string) => boolean,
): ParadexSummaryValues | typeof PARADEX_SBE_IGNORED | null {
  const frame = readSummaryFrame(raw, accept);
  if (frame === null || frame === PARADEX_SBE_IGNORED) return frame;
  const { buffer, symbol } = frame;
  const fundingRatePrecise = hasPreciseFunding(frame) ? optionalNumber(buffer, 232, 12) : null;

  return {
    symbol,
    mark_price: optionalNumber(buffer, 16),
    underlying_price: optionalNumber(buffer, 24),
    last_traded_price: optionalNumber(buffer, 32),
    volume_24h: optionalNumber(buffer, 40),
    open_interest: optionalNumber(buffer, 48),
    funding_rate: fundingRatePrecise ?? optionalNumber(buffer, 56),
    bid: optionalNumber(buffer, 64),
    ask: optionalNumber(buffer, 72),
    mark_iv: optionalNumber(buffer, 96),
    bid_iv: optionalNumber(buffer, 104),
    ask_iv: optionalNumber(buffer, 112),
    bid_size: optionalNumber(buffer, 200),
    ask_size: optionalNumber(buffer, 208),
    greeks: {
      delta: optionalNumber(buffer, 128),
      gamma: optionalNumber(buffer, 136),
      vega: optionalNumber(buffer, 144),
      theta: optionalNumber(buffer, 152),
      rho: optionalNumber(buffer, 160),
      volga: optionalNumber(buffer, 168),
      vanna: optionalNumber(buffer, 176),
    },
    created_at: createdAtMs(buffer),
  };
}
