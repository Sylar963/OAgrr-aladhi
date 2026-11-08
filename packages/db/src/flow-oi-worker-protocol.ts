import { type FlowOiTick, FlowOiTickSchema } from '@oggregator/protocol';
import { z } from 'zod';

const tickSchema = z.custom<FlowOiTick>((value) => FlowOiTickSchema.safeParse(value).success);

export const FlowOiWorkerOptionsSchema = z.object({
  path: z.string(),
  connectionString: z.string().optional(),
  flushIntervalMs: z.number().positive().optional(),
});

export const FlowOiWorkerRequestSchema = z.discriminatedUnion('method', [
  z.object({ id: z.number(), method: z.literal('append'), ticks: z.array(tickSchema) }),
  z.object({
    id: z.number(),
    method: z.literal('bracket'),
    venue: z.string(),
    instrument: z.string(),
    timestamp: z.number(),
  }),
  z.object({ id: z.number(), method: z.literal('prune'), before: z.number() }),
  z.object({ id: z.number(), method: z.literal('flush') }),
  z.object({ id: z.number(), method: z.literal('dispose') }),
]);

export const FlowOiWorkerResponseSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('result'), id: z.number(), value: z.unknown() }),
  z.object({ type: z.literal('error'), id: z.number(), message: z.string() }),
  z.object({ type: z.literal('warning'), message: z.string() }),
]);

export const FlowOiBracketSchema = z.object({
  before: tickSchema.nullable(),
  after: tickSchema.nullable(),
});

export type FlowOiBracket = z.infer<typeof FlowOiBracketSchema>;
export type FlowOiWorkerRequest = z.infer<typeof FlowOiWorkerRequestSchema>;
