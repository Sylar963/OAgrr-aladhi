import type { ExpectedMoveAsset } from '@oggregator/protocol';
import { z } from 'zod';

const TimestampSchema = z.object({
  expiry: z.string().date(),
  expiryTs: z.number().finite().nullable(),
});
const ExpiriesSchema = z.object({
  expiries: z.array(z.string().date()),
  timestamps: z.array(TimestampSchema).optional(),
});

export const ExpectedMoveExpiriesSchema = ExpiriesSchema.extend({
  byVenue: z.array(ExpiriesSchema.extend({ venue: z.string() })).optional(),
});

const nyDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function selectExpectedMoveExpiries(
  data: z.infer<typeof ExpectedMoveExpiriesSchema>,
  asset: ExpectedMoveAsset,
  venue: string,
  nowMs = Date.now(),
): string[] {
  const source = asset === 'SPX' ? data : data.byVenue?.find((v) => v.venue === venue);
  if (source == null) return [];
  const timestamps = new Map(source.timestamps?.map((entry) => [entry.expiry, entry.expiryTs]));
  const parts = nyDate.formatToParts(nowMs);
  const part = (kind: string) => parts.find((p) => p.type === kind)?.value ?? '';
  const today =
    asset === 'SPX'
      ? `${part('year')}-${part('month')}-${part('day')}`
      : new Date(nowMs).toISOString().slice(0, 10);
  return [...new Set(source.expiries)]
    .filter((expiry) => {
      const timestamp = timestamps.get(expiry);
      return timestamp != null ? timestamp > nowMs : expiry >= today;
    })
    .sort();
}
