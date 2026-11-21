import { NewsRuntime, type NewsArchiveSink, type NewsRuntimeOptions } from '@oggregator/core';
export {
  NewsRuntime,
  type NewsItem,
  type NewsArchiveSink,
  type NewsRuntimeOptions,
} from '@oggregator/core';

export function createNewsRuntimeFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  log?: NewsRuntimeOptions['log'],
  archive?: NewsArchiveSink,
  delivery?: NewsRuntimeOptions['delivery'],
): NewsRuntime | null {
  const baseUrl = env['OP_FEED_BASE_URL'];
  const secret = env['OP_FEED_SECRET'];
  if (!baseUrl || !secret) return null;
  const pollIntervalMs = Number(env['NEWS_POLL_INTERVAL_MS'] ?? 15_000);
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 1000 || pollIntervalMs > 60_000) {
    throw new Error('NEWS_POLL_INTERVAL_MS must be between 1000 and 60000');
  }
  return new NewsRuntime({
    baseUrl,
    secret,
    pollIntervalMs,
    ...(log ? { log } : {}),
    ...(archive ? { archive } : {}),
    ...(delivery ? { delivery } : {}),
  });
}
