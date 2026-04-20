import {
  CoincallBsInfoMessageSchema,
  CoincallHeartbeatAckSchema,
  CoincallInstrumentsResponseSchema,
  CoincallOrderBookMessageSchema,
  CoincallPublicConfigSchema,
  CoincallTOptionMessageSchema,
  CoincallTimeSchema,
  type CoincallBsInfoMessage,
  type CoincallHeartbeatAck,
  type CoincallInstrumentsResponse,
  type CoincallOrderBookMessage,
  type CoincallPublicConfig,
  type CoincallTOptionMessage,
} from './types.js';

export function parseCoincallInstruments(input: unknown): CoincallInstrumentsResponse | null {
  const parsed = CoincallInstrumentsResponseSchema.safeParse(input);
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

export function parseCoincallBsInfoMessage(input: unknown): CoincallBsInfoMessage | null {
  const parsed = CoincallBsInfoMessageSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function parseCoincallTOptionMessage(input: unknown): CoincallTOptionMessage | null {
  const parsed = CoincallTOptionMessageSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function parseCoincallOrderBookMessage(input: unknown): CoincallOrderBookMessage | null {
  const parsed = CoincallOrderBookMessageSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function parseCoincallHeartbeatAck(input: unknown): CoincallHeartbeatAck | null {
  const parsed = CoincallHeartbeatAckSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}
