import {
  ExpectedMoveResponseSchema,
  ExpectedStraddleResponseSchema,
  type ExpectedMoveAnchor,
  type ExpectedMoveAsset,
} from '@oggregator/protocol';
import { fetchJson } from '@lib/http';
import { tradfiFetchJson } from '@lib/tradfi-http';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

function read(asset: ExpectedMoveAsset, path: string): Promise<unknown> {
  return asset === 'SPX' ? tradfiFetchJson<unknown>(path) : fetchJson<unknown>(path);
}

export function useExpectedMove(
  asset: ExpectedMoveAsset | null,
  anchor: ExpectedMoveAnchor,
  days: number,
) {
  return useQuery({
    queryKey: ['expected-move', asset, anchor, days],
    queryFn: async () => {
      if (asset == null) throw new Error('Unsupported expected-move asset');
      return ExpectedMoveResponseSchema.parse(
        await read(
          asset,
          `/expected-move?${new URLSearchParams({ underlying: asset, anchor, days: String(days) })}`,
        ),
      );
    },
    enabled: asset != null,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

const ExpiriesSchema = z.object({
  expiries: z.array(z.string().date()),
  byVenue: z
    .array(z.object({ venue: z.string(), expiries: z.array(z.string().date()) }))
    .optional(),
});

export function useExpectedMoveExpiries(
  asset: ExpectedMoveAsset | null,
  venue: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['expected-move-expiries', asset, venue],
    queryFn: async () => {
      if (asset == null) throw new Error('Unsupported expected-move asset');
      const data = ExpiriesSchema.parse(await read(asset, `/expiries?underlying=${asset}`));
      return [
        ...(asset === 'SPX'
          ? data.expiries
          : (data.byVenue?.find((v) => v.venue === venue)?.expiries ?? [])),
      ].sort();
    },
    enabled: asset != null && enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useExpectedStraddle(
  asset: ExpectedMoveAsset | null,
  venue: string,
  expiry: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['expected-move-straddle', asset, venue, expiry],
    queryFn: async () => {
      if (asset == null) throw new Error('Unsupported expected-move asset');
      return ExpectedStraddleResponseSchema.parse(
        await read(
          asset,
          `/expected-move/straddle?${new URLSearchParams({ underlying: asset, venue, expiry })}`,
        ),
      );
    },
    enabled: asset != null && Boolean(expiry) && enabled,
    staleTime: 5_000,
    refetchInterval: 15_000,
  });
}
