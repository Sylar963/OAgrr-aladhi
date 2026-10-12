export interface TradfiConfig {
  port: number;
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  underlyings: string[];
  userAgent: string;
  /** Separate from the crypto DATABASE_URL; IV history stays in the local cache while unset. */
  databaseUrl: string | null;
  ivHistoryUnderlyings: string[];
  ivHistoryCachePath: string;
}

const DEFAULT_UNDERLYINGS = ['SPX', 'NDX', 'SPY', 'QQQ', 'AAPL', 'NVDA', 'TSLA'];

function symbolList(raw: string | undefined, fallback: string[]): string[] {
  return raw ? raw.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) : fallback;
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (value == null || value.trim() === '') {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): TradfiConfig {
  const underlyings = symbolList(env.TRADFI_UNDERLYINGS, DEFAULT_UNDERLYINGS);

  const port = env.TRADFI_PORT ? Number(env.TRADFI_PORT) : 3200;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid TRADFI_PORT: ${env.TRADFI_PORT}`);
  }

  return {
    port,
    baseUrl: env.TASTYTRADE_BASE_URL ?? 'https://api.tastyworks.com',
    clientId: required(env, 'TASTYTRADE_CLIENT_ID'),
    clientSecret: required(env, 'TASTYTRADE_CLIENT_SECRET'),
    refreshToken: required(env, 'TASTYTRADE_REFRESH_TOKEN'),
    underlyings,
    userAgent: env.TASTYTRADE_USER_AGENT ?? 'oggregator-tradfi/0.1',
    databaseUrl: env.TRADFI_DATABASE_URL?.trim() || null,
    ivHistoryUnderlyings: symbolList(env.TRADFI_IV_HISTORY_UNDERLYINGS, DEFAULT_UNDERLYINGS).filter(
      (u) => underlyings.includes(u),
    ),
    ivHistoryCachePath: env.TRADFI_IV_HISTORY_CACHE_PATH ?? '.cache/iv-history-points.ndjson',
  };
}
