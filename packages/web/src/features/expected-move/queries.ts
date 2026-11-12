import {
  ExpectedMoveResponseSchema,
  ExpectedStraddleResponseSchema,
  type ExpectedMoveAnchor,
  type ExpectedMoveAsset,
  type ExpectedMoveSession,
} from '@oggregator/protocol';
import { fetchJson } from '@lib/http';
import { tradfiFetchJson } from '@lib/tradfi-http';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { ExpectedMoveExpiriesSchema, selectExpectedMoveExpiries } from './expiry-selection';
import type { RadarCandle } from './radar-model';

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

const SpotPathSchema = z.object({
  candles: z.array(
    z.object({
      timestamp: z.number().int(),
      open: z.number().positive(),
      close: z.number().positive(),
    }),
  ),
});
const CashPathSchema = z.object({
  candles: z.array(
    z.object({
      ts: z.number().int(),
      o: z.number().positive(),
      c: z.number().positive(),
      synthetic: z.boolean(),
    }),
  ),
});

export function useRadarPath(asset: ExpectedMoveAsset, session: ExpectedMoveSession | null) {
  return useQuery({
    queryKey: ['expected-move-path', asset, session?.startMs],
    queryFn: async (): Promise<{
      candles: RadarCandle[];
      resolutionMs: number;
      asOfMs: number;
    }> => {
      if (session == null) throw new Error('No session selected');
      const asOfMs = Date.now();
      if (asset === 'SPX') {
        const older = Date.now() - session.startMs > 29 * 86_400_000;
        const range = older ? 'max' : session.complete ? '30d' : '1d';
        const interval = older ? '1h' : '5m';
        const data = CashPathSchema.parse(
          await read(
            asset,
            `/underlying-candles?underlying=SPX&interval=${interval}&range=${range}`,
          ),
        );
        return {
          candles: data.candles
            .filter((c) => !c.synthetic)
            .map((c) => ({ timestamp: c.ts, open: c.o, close: c.c })),
          resolutionMs: older ? 3_600_000 : 300_000,
          asOfMs,
        };
      }
      const age = Date.now() - session.startMs;
      const resolution = age > 9 * 86_400_000 ? 3600 : 300;
      const buckets = Math.min(3000, Math.max(2, Math.ceil(age / (resolution * 1000)) + 2));
      const data = SpotPathSchema.parse(
        await read(
          asset,
          `/spot-candles?currency=${asset}&resolution=${resolution}&buckets=${buckets}`,
        ),
      );
      return { candles: data.candles, resolutionMs: resolution * 1000, asOfMs };
    },
    enabled: session != null,
    staleTime: session?.complete ? 300_000 : 15_000,
    refetchInterval: session?.complete ? false : 30_000,
  });
}
