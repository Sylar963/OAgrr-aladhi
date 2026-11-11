import {
  ExpectedMoveResponseSchema,
  ExpectedStraddleResponseSchema,
  type ExpectedMoveAnchor,
  type ExpectedMoveAsset,
} from '@oggregator/protocol';
import { fetchJson } from '@lib/http';
import { tradfiFetchJson } from '@lib/tradfi-http';
import { useQuery } from '@tanstack/react-query';
import { ExpectedMoveExpiriesSchema, selectExpectedMoveExpiries } from './expiry-selection';

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

export function useExpectedMoveExpiries(
  asset: ExpectedMoveAsset | null,
  venue: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['expected-move-expiries', asset, venue],
    queryFn: async () => {
      if (asset == null) throw new Error('Unsupported expected-move asset');
      return ExpectedMoveExpiriesSchema.parse(await read(asset, `/expiries?underlying=${asset}`));
    },
    select: (data) => (asset == null ? [] : selectExpectedMoveExpiries(data, asset, venue)),
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
