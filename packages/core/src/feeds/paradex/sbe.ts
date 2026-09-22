import type WebSocket from 'ws';
import type { ParadexSummary } from './types.js';

const HEADER_LENGTH = 8;
const MARKET_SUMMARY_TEMPLATE_ID = 4;
const PARADEX_SCHEMA_ID = 1;
const VERSION_ZERO_BLOCK_LENGTH = 216;
const VERSION_ONE_BLOCK_LENGTH = 240;
const NULL_INT64 = -(1n << 63n);

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

function requiredDecimal(buffer: Buffer, bodyOffset: number, scale = 8): string {
  return optionalDecimal(buffer, bodyOffset, scale) ?? '';
}

export function decodeParadexMarketSummarySbe(raw: WebSocket.RawData): ParadexSummary | null {
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

  const tsMicros = buffer.readBigInt64LE(HEADER_LENGTH);
  const fundingRatePrecise =
    version >= 1 && blockLength >= VERSION_ONE_BLOCK_LENGTH
      ? optionalDecimal(buffer, 232, 12)
      : null;

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
    created_at: Number(tsMicros / 1_000n),
  };
}
