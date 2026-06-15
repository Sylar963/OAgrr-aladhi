export interface TradfiConfig {
  port: number;
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  underlyings: string[];
  userAgent: string;
}

const DEFAULT_UNDERLYINGS = ['SPX', 'NDX', 'SPY', 'QQQ', 'AAPL', 'NVDA', 'TSLA'];

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (value == null || value.trim() === '') {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): TradfiConfig {
  const underlyingsRaw = env.TRADFI_UNDERLYINGS;
  const underlyings = underlyingsRaw
    ? underlyingsRaw.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
    : DEFAULT_UNDERLYINGS;

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
  };
}
