import { z } from 'zod';

/** Who is asking. Set by the API from the verified Clerk session, never from the browser. */
export const LiveActorSchema = z.object({
  clerkUserId: z.string().min(1).max(128),
  accountId: z.string().min(1).max(128),
});
export type LiveActor = z.infer<typeof LiveActorSchema>;

export const KillScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('global') }),
  z.object({ kind: z.literal('subaccount'), venueAccount: z.string().min(1).max(64) }),
]);
export type KillScope = z.infer<typeof KillScopeSchema>;

const ReasonSchema = z.string().min(1).max(280);

export const ExecutionCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('status') }),
  z.object({ type: z.literal('arm') }),
  z.object({ type: z.literal('disarm'), reason: ReasonSchema }),
  z.object({ type: z.literal('kill'), scope: KillScopeSchema, reason: ReasonSchema }),
  z.object({ type: z.literal('reset'), reason: ReasonSchema }),
]);
export type ExecutionCommand = z.infer<typeof ExecutionCommandSchema>;

/** One line on the daemon socket. `hmac` covers the canonical JSON of every other field. */
export const ExecutionEnvelopeSchema = z.object({
  command: ExecutionCommandSchema,
  actor: LiveActorSchema,
  idempotencyKey: z.string().uuid(),
  nonce: z.number().int().nonnegative(),
  ts: z.number().int().positive(),
  hmac: z.string().regex(/^[a-f0-9]{64}$/),
});
export type ExecutionEnvelope = z.infer<typeof ExecutionEnvelopeSchema>;
export type UnsignedExecutionEnvelope = Omit<ExecutionEnvelope, 'hmac'>;

export const LiveControlStateSchema = z.enum(['disarmed', 'armed', 'killed']);
export type LiveControlState = z.infer<typeof LiveControlStateSchema>;

export const LiveStatusSchema = z.object({
  state: LiveControlStateSchema,
  killedReason: z.string().nullable(),
  keyBound: z.boolean(),
  venue: z.object({
    name: z.string(),
    connected: z.boolean(),
  }),
  alerts: z.object({
    telegramConfigured: z.boolean(),
    emailConfigured: z.boolean(),
    testDelivered: z.boolean(),
  }),
  journal: z.object({
    lastSeq: z.number().int().nonnegative(),
    chainOk: z.boolean(),
  }),
});
export type LiveStatus = z.infer<typeof LiveStatusSchema>;

export const ExecutionErrorCodeSchema = z.enum([
  'invalid_request',
  'unauthenticated',
  'stale_request',
  'replayed_nonce',
  'not_bound',
  'alerts_unavailable',
  'killed',
  'internal',
]);
export type ExecutionErrorCode = z.infer<typeof ExecutionErrorCodeSchema>;

export const ExecutionResponseSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), status: LiveStatusSchema }),
  z.object({
    ok: z.literal(false),
    error: z.object({ code: ExecutionErrorCodeSchema, message: z.string() }),
  }),
]);
export type ExecutionResponse = z.infer<typeof ExecutionResponseSchema>;

export const AlertSeveritySchema = z.enum(['critical', 'error', 'info']);
export type AlertSeverity = z.infer<typeof AlertSeveritySchema>;

export const LiveAlertSchema = z.object({
  id: z.string().min(1).max(128),
  source: z.string(),
  event: z.string(),
  severity: AlertSeveritySchema,
  message: z.string().max(1000),
  ts: z.string(),
  details: z.record(z.string(), z.unknown()),
});
export type LiveAlert = z.infer<typeof LiveAlertSchema>;

/** Deterministic JSON (sorted keys) so both ends sign the same bytes. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}
