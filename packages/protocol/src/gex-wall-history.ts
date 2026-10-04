import { z } from 'zod';

export const GEX_WALL_HISTORY_RESOLUTION_SEC = 900;
export const GEX_WALL_HISTORY_MAX_DAYS = 90;

export const GexWallHistoryQuerySchema = z.object({
  underlying: z
    .string()
    .trim()
    .min(2)
    .max(20)
    .transform((value) => value.toUpperCase()),
  days: z.coerce.number().int().min(1).max(GEX_WALL_HISTORY_MAX_DAYS).default(30),
});

export type GexWallHistoryQuery = z.infer<typeof GexWallHistoryQuerySchema>;

export const GexWallHistoryPointSchema = z.object({
  /** Slot start, epoch ms, aligned to the 15-minute grid. */
  ts: z.number().int(),
  spot: z.number().nullable(),
  callWall: z.number().nullable(),
  putWall: z.number().nullable(),
  gammaFlip: z.number().nullable(),
});

export type GexWallHistoryPoint = z.infer<typeof GexWallHistoryPointSchema>;

export const GexWallHistoryResponseSchema = z.object({
  underlying: z.string(),
  resolutionSec: z.literal(GEX_WALL_HISTORY_RESOLUTION_SEC),
  points: z.array(GexWallHistoryPointSchema),
});

export type GexWallHistoryResponse = z.infer<typeof GexWallHistoryResponseSchema>;
