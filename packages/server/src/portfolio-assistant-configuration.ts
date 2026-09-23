export interface PortfolioAssistantConfiguration {
  enabled: boolean;
  apiUrl: string;
  apiKey: string | null;
  model: string;
  requestTimeoutMs: number;
  dailyQuestionLimit: number;
  maxConcurrentRequests: number;
  retentionDays: number;
  inviteHashSecret: string | null;
  maxContextCharacters: number;
}

function positiveInteger(raw: string | undefined, fallback: number, name: string): number {
  if (raw == null || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

export function readPortfolioAssistantConfiguration(
  env: NodeJS.ProcessEnv,
): PortfolioAssistantConfiguration {
  const enabled =
    env['PORTFOLIO_ASSISTANT_ENABLED'] === 'true' || env['PORTFOLIO_ASSISTANT_ENABLED'] === '1';
  const apiUrl =
    env['HERMES_PORTFOLIO_API_URL'] ??
    'http://127.0.0.1:8642/p/portfolio-chat/v1';
  const apiKey = env['HERMES_PORTFOLIO_API_KEY']?.trim() || null;
  const inviteHashSecret = env['PORTFOLIO_ASSISTANT_INVITE_HASH_SECRET']?.trim() || null;
  if (enabled) {
    if (!apiKey)
      throw new Error('HERMES_PORTFOLIO_API_KEY is required when Portfolio Assistant is enabled');
    if (!inviteHashSecret)
      throw new Error(
        'PORTFOLIO_ASSISTANT_INVITE_HASH_SECRET is required when Portfolio Assistant is enabled',
      );
    try {
      new URL(apiUrl);
    } catch {
      throw new Error('HERMES_PORTFOLIO_API_URL must be an absolute URL');
    }
  }
  return {
    enabled,
    apiUrl: apiUrl.replace(/\/$/, ''),
    apiKey,
    model: env['HERMES_PORTFOLIO_MODEL']?.trim() || 'portfolio-chat',
    requestTimeoutMs: positiveInteger(
      env['HERMES_PORTFOLIO_REQUEST_TIMEOUT_MS'],
      90_000,
      'HERMES_PORTFOLIO_REQUEST_TIMEOUT_MS',
    ),
    dailyQuestionLimit: positiveInteger(
      env['PORTFOLIO_ASSISTANT_DAILY_QUESTION_LIMIT'],
      20,
      'PORTFOLIO_ASSISTANT_DAILY_QUESTION_LIMIT',
    ),
    maxConcurrentRequests: positiveInteger(
      env['PORTFOLIO_ASSISTANT_MAX_CONCURRENT_REQUESTS'],
      4,
      'PORTFOLIO_ASSISTANT_MAX_CONCURRENT_REQUESTS',
    ),
    retentionDays: positiveInteger(
      env['PORTFOLIO_ASSISTANT_RETENTION_DAYS'],
      30,
      'PORTFOLIO_ASSISTANT_RETENTION_DAYS',
    ),
    inviteHashSecret,
    maxContextCharacters: positiveInteger(
      env['PORTFOLIO_ASSISTANT_MAX_CONTEXT_CHARACTERS'],
      160_000,
      'PORTFOLIO_ASSISTANT_MAX_CONTEXT_CHARACTERS',
    ),
  };
}
