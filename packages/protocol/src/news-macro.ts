import { z } from 'zod';
const FigureSchema = z.object({
  role: z.enum(['actual', 'forecast', 'previous', 'revised']),
  value: z.number().finite(),
  unit: z.string().nullable(),
  evidence: z.string(),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
});
export const ReportedMacroHeadlineSchema = z.object({
  eventId: z.string(),
  cursor: z.string(),
  revision: z.number(),
  eventName: z.string(),
  country: z.string().nullable(),
  source: z.string(),
  url: z.string(),
  text: z.string(),
  publishedAt: z.number(),
  receivedAt: z.number(),
  scheduledAt: z.null(),
  actual: FigureSchema.nullable(),
  forecast: FigureSchema.nullable(),
  previous: FigureSchema.nullable(),
  revised: FigureSchema.nullable(),
  figures: z.array(FigureSchema),
  sourceVerified: z.literal(false),
  provenance: z.literal('headline-text'),
  extractionVersion: z.literal('macro-literals-v1'),
});
export type ReportedMacroHeadline = z.infer<typeof ReportedMacroHeadlineSchema>;
export const NewsMacroResponseSchema = z.object({
  mode: z.literal('reported-headline-figures'),
  scheduledCalendarAvailable: z.literal(false),
  items: z.array(ReportedMacroHeadlineSchema),
  nextCursor: z.string(),
  oldestCursor: z.string().nullable(),
  hasMore: z.boolean(),
  scanned: z.number(),
  generatedAt: z.number(),
});
