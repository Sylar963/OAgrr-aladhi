import { z } from 'zod';
import {
  PARADEX_MARKETS,
  PARADEX_MARKETS_SUMMARY,
  PARADEX_REST_BASE_URL,
  PARADEX_SYSTEM_TIME,
} from '../shared/endpoints.js';
import { parseParadexMarkets, parseParadexSummaries } from './codec.js';
import type { ParadexMarket, ParadexSummary } from './types.js';

const PARADEX_REST_TIMEOUT_MS = 10_000;

async function getJson(path: string): Promise<unknown> {
  const res = await fetch(`${PARADEX_REST_BASE_URL}${path}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(PARADEX_REST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`paradex GET ${path} -> HTTP ${res.status}`);
  return res.json();
}

/** All markets (perps/spot/options). Caller filters asset_kind. */
export async function fetchParadexMarkets(): Promise<ParadexMarket[]> {
  return parseParadexMarkets(await getJson(PARADEX_MARKETS));
}

/** Bulk dynamic data for every market in one call. */
export async function fetchParadexSummaryAll(): Promise<ParadexSummary[]> {
  return parseParadexSummaries(await getJson(`${PARADEX_MARKETS_SUMMARY}?market=ALL`));
}

const ServerTimeSchema = z.object({ server_time: z.string().optional() });

/** Server time (ms) — health probe. Returns null on failure. */
export async function fetchParadexServerTime(): Promise<number | null> {
  try {
    const parsed = ServerTimeSchema.safeParse(await getJson(PARADEX_SYSTEM_TIME));
    if (!parsed.success) return null;
    const n = Number(parsed.data.server_time);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}
