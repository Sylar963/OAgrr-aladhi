import { z } from 'zod';
import {
  PARADEX_MARKETS,
  PARADEX_MARKETS_SUMMARY,
  PARADEX_REST_BASE_URL,
  PARADEX_SYSTEM_TIME,
  PARADEX_TRADES,
} from '../shared/endpoints.js';
import { parseParadexMarkets, parseParadexSummariesWhere } from './codec.js';
import { ParadexTradesResponseSchema } from './types.js';
import type { ParadexMarket, ParadexSummary, ParadexTrade } from './types.js';

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

/** Bulk dynamic data in one call, validated only for the markets `accept` keeps. */
export async function fetchParadexSummaries(
  accept: (symbol: string) => boolean,
): Promise<ParadexSummary[]> {
  return parseParadexSummariesWhere(await getJson(`${PARADEX_MARKETS_SUMMARY}?market=ALL`), accept);
}

/**
 * Per-symbol trade tape for the FLOW page. Paradex's WS `trades.{symbol}` ACKs
 * but delivers no frames (verified 2026-06-08), so FLOW seeds/polls via REST
 * like the other sparse venues. Newest-first; returns [] on a malformed payload.
 */
export async function fetchParadexTrades(market: string, pageSize = 100): Promise<ParadexTrade[]> {
  const path = `${PARADEX_TRADES}?market=${encodeURIComponent(market)}&page_size=${pageSize}`;
  const parsed = ParadexTradesResponseSchema.safeParse(await getJson(path));
  return parsed.success ? parsed.data.results : [];
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
