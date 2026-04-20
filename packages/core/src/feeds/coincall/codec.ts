import {
  CoincallInstrumentSchema,
  CoincallMarkPriceSchema,
  CoincallOptionChainSchema,
  CoincallIndexPriceSchema,
  CoincallTickerSchema,
  CoincallPublicConfigSchema,
  CoincallTimeSchema,
  CoincallWsMessageSchema,
  CoincallWsResponseSchema,
  type CoincallInstrument,
  type CoincallMarkPrice,
  type CoincallOptionChain,
  type CoincallIndexPrice,
  type CoincallTicker,
  type CoincallPublicConfig,
  type CoincallTime,
  type CoincallWsMessage,
  type CoincallWsResponse,
} from './types.js';

export function parseCoincallInstrument(input: unknown): CoincallInstrument | null {
  const parsed = CoincallInstrumentSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function parseCoincallMarkPrice(input: unknown): CoincallMarkPrice | null {
  const parsed = CoincallMarkPriceSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function parseCoincallOptionChain(input: unknown): CoincallOptionChain | null {
  const parsed = CoincallOptionChainSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function parseCoincallIndexPrice(input: unknown): CoincallIndexPrice | null {
  const parsed = CoincallIndexPriceSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function parseCoincallTicker(input: unknown): CoincallTicker | null {
  const parsed = CoincallTickerSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function parseCoincallPublicConfig(input: unknown): CoincallPublicConfig | null {
  const parsed = CoincallPublicConfigSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function parseCoincallTime(input: unknown): number | null {
  const parsed = CoincallTimeSchema.safeParse(input);
  return parsed.success ? parsed.data.serverTime : null;
}

export function parseCoincallWsMessage(input: unknown): CoincallWsMessage | null {
  const parsed = CoincallWsMessageSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function parseCoincallWsResponse(input: unknown): CoincallWsResponse | null {
  const parsed = CoincallWsResponseSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function isCoincallWsSuccess(input: unknown): boolean {
  const response = parseCoincallWsResponse(input);
  return response != null && (response.code === 0 || response.result !== undefined);
}