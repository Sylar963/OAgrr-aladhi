import { z } from 'zod';

export const VOL_HEATMAP_CURRENCIES = ['BTC', 'ETH'] as const;
/** IV bucket height as a fraction (0.0025 = 0.25 vol points). */
export const VOL_HEATMAP_BUCKET = 0.0025;
export const VOL_HEATMAP_COLUMN_MS = 15_000;
export const VOL_HEATMAP_RETENTION_MS = 24 * 60 * 60 * 1000;
export const VOL_HEATMAP_RESOLUTIONS_SEC = [15, 60, 300] as const;
export const VOL_HEATMAP_WINDOW_HOURS = [1, 6, 24] as const;

const oneOf = <T extends readonly number[]>(values: T, label: string) =>
  z.coerce
    .number()
    .int()
    .refine((v) => (values as readonly number[]).includes(v), {
      message: `${label} must be one of ${values.join(', ')}`,
    });

export const VolHeatmapQuerySchema = z.object({
  currency: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .pipe(z.enum(VOL_HEATMAP_CURRENCIES)),
  hours: oneOf(VOL_HEATMAP_WINDOW_HOURS, 'hours').default(6),
  /** Omit to let the server pick the finest resolution that keeps the window's data readable. */
  resolutionSec: oneOf(VOL_HEATMAP_RESOLUTIONS_SEC, 'resolutionSec').optional(),
  /** Epoch ms; only columns whose (resolution-aligned) start is at or after this are returned. */
  since: z.coerce.number().int().nonnegative().optional(),
});

export type VolHeatmapQuery = z.infer<typeof VolHeatmapQuerySchema>;

/**
 * `[bucket, bidVega, askVega]`. The bucket's IV centre is `bucket × VOL_HEATMAP_BUCKET`.
 * Vega is USD per one vol point, time-averaged over the column.
 */
export const VolHeatmapCellSchema = z.tuple([z.number().int(), z.number(), z.number()]);

export const VolHeatmapTradeSchema = z.object({
  t: z.number().int(),
  instrument: z.string(),
  side: z.enum(['buy', 'sell']),
  /** IV as a fraction. */
  iv: z.number(),
  /** Skew-adjusted IV (see `adjCells`); null when the option had no two-sided book. */
  adjIv: z.number().nullable(),
  amount: z.number(),
  /** USD per one vol point (amount × vega). */
  vega: z.number(),
});

export const VolHeatmapColumnSchema = z.object({
  /** Column start, epoch ms. */
  t: z.number().int(),
  /** Last DVOL print in the column, as a fraction. */
  dvol: z.number().nullable(),
  cells: z.array(VolHeatmapCellSchema),
  /**
   * Same vega placed at `iv − mid(option) + atmMid`: each order's distance from its own option's
   * mid IV, re-centred on the 30d ATM mid. Removes the smile so strikes line up.
   */
  adjCells: z.array(VolHeatmapCellSchema),
  /** Book-implied 30d ATM mid IV (fraction), averaged over the column. */
  atmMid: z.number().nullable(),
  trades: z.array(VolHeatmapTradeSchema),
});

export const VolHeatmapMetaSchema = z.object({
  expiries: z.array(z.string()),
  instruments: z.number().int(),
  updatedAt: z.number().int(),
});

export const VolHeatmapResponseSchema = z.object({
  currency: z.enum(VOL_HEATMAP_CURRENCIES),
  asOf: z.number().int(),
  bucketSize: z.number(),
  resolutionSec: z.number().int(),
  meta: VolHeatmapMetaSchema.nullable(),
  columns: z.array(VolHeatmapColumnSchema),
});

export type VolHeatmapCell = z.infer<typeof VolHeatmapCellSchema>;
export type VolHeatmapTrade = z.infer<typeof VolHeatmapTradeSchema>;
export type VolHeatmapColumn = z.infer<typeof VolHeatmapColumnSchema>;
export type VolHeatmapMeta = z.infer<typeof VolHeatmapMetaSchema>;
export type VolHeatmapResponse = z.infer<typeof VolHeatmapResponseSchema>;
