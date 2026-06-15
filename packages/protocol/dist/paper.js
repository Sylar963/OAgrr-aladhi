import { z } from 'zod';
export const PAPER_VENUE_IDS = [
    'deribit',
    'okx',
    'bybit',
    'binance',
    'derive',
    'coincall',
    'thalex',
];
export const PaperVenueIdSchema = z.enum(PAPER_VENUE_IDS);
export const PaperOrderLegSchema = z.object({
    index: z.number().int().nonnegative(),
    side: z.enum(['buy', 'sell']),
    optionRight: z.enum(['call', 'put']),
    underlying: z.string().min(1),
    expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    strike: z.number().positive(),
    quantity: z.number().positive(),
    preferredVenues: z.array(PaperVenueIdSchema).nullable(),
});
export const PlaceOrderRequestSchema = z.object({
    clientOrderId: z.string().optional(),
    legs: z.array(PaperOrderLegSchema.omit({ index: true }).extend({
        preferredVenues: PaperOrderLegSchema.shape.preferredVenues.optional(),
    })).min(1),
    venueFilter: z.array(PaperVenueIdSchema).default([]),
});
export const PaperTradeStatusSchema = z.enum(['open', 'closed']);
export const PaperTradeOrderIntentSchema = z.enum([
    'open',
    'add',
    'reduce',
    'close',
    'roll',
    'settlement',
]);
export const PaperTradeNoteKindSchema = z.enum(['thesis', 'invalidation', 'review', 'note']);
export const CreatePaperTradeRequestSchema = z.object({
    label: z.string().min(1).max(120).optional(),
    strategyName: z.string().min(1).max(120).optional(),
    thesis: z.string().min(1).max(2_000).optional(),
    invalidation: z.string().min(1).max(2_000).optional(),
    order: PlaceOrderRequestSchema,
});
export const CreatePaperTradeNoteRequestSchema = z.object({
    kind: PaperTradeNoteKindSchema,
    content: z.string().min(1).max(2_000),
    tags: z.array(z.string().min(1).max(32)).max(12).default([]),
});
export const ReducePaperTradeRequestSchema = z.object({
    fraction: z.number().positive().max(1),
});
export const InitPaperAccountRequestSchema = z.object({
    initialCashUsd: z.number().int().min(1_000).max(100_000).multipleOf(1_000),
});
//# sourceMappingURL=paper.js.map