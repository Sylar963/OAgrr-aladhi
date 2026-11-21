import { z } from 'zod';

export const DepthNumberSchema = z
  .union([z.number(), z.string().regex(/^\d+(?:\.\d+)?$/)])
  .transform(Number)
  .pipe(z.number().finite().nonnegative());
export const DepthSequenceSchema = z
  .union([z.string().regex(/^\d+$/), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)])
  .transform(String);
export const DepthPairsSchema = z
  .array(z.tuple([DepthNumberSchema, DepthNumberSchema]).rest(z.unknown()))
  .max(1000);
export type NativeDepthLevel = [number, number];
export interface NativeDepthSnapshot {
  bids: NativeDepthLevel[];
  asks: NativeDepthLevel[];
  exchangeTs: number | null;
  lastChangeAt: number | null;
  sequence: string | null;
  exchangeTimestampBasis: 'generation' | 'last-change' | 'not-provided';
  sourceMaxLevels: number;
  priceCurrency?: string;
  referencePriceUsd?: number;
  receivedAt?: number;
  requestedAt?: number;
  connectionGeneration?: number;
}
export type DepthReader = (url: string) => Promise<unknown>;
export type PublicDepthFetcher = (
  symbol: string,
  read: DepthReader,
  access: 'api' | 'interactive',
) => Promise<NativeDepthSnapshot>;
export class PublicDepthError extends Error {
  constructor(
    readonly reason:
      | 'capacity'
      | 'upstream-http'
      | 'upstream-timeout'
      | 'invalid-book'
      | 'unsupported-access'
      | 'disposed',
  ) {
    super(`Public option depth unavailable: ${reason}`);
  }
}
export function depthPairs(levels: Array<[number, number, ...unknown[]]>): NativeDepthLevel[] {
  return levels.map(([price, amount]) => [price, amount]);
}
