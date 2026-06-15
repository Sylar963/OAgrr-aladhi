import { z } from 'zod';

const SpotItemSchema = z.object({
  symbol: z.string(),
  lastPrice: z.number(),
  change24hPct: z.number(),
});
const SpotsResponseSchema = z.object({ items: z.array(SpotItemSchema) });

export type SpotItem = z.infer<typeof SpotItemSchema>;

// Server-only: reads LANDING_API_BASE_URL (never NEXT_PUBLIC) and is only
// imported from Server Components. Returns null on any failure so callers fall
// back to demo data — the marketing page must never depend on API uptime.
export async function fetchSpots(): Promise<SpotItem[] | null> {
  const apiBase = process.env.LANDING_API_BASE_URL;
  if (!apiBase) return null;

  try {
    const res = await fetch(`${apiBase}/api/spots`, {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return null;
    const parsed = SpotsResponseSchema.safeParse(await res.json());
    return parsed.success ? parsed.data.items : null;
  } catch {
    return null;
  }
}
