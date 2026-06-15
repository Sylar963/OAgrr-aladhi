import { loadConfig } from './config.js';
import { logger } from './logger.js';
import { OAuth2TokenManager } from './tastytrade/auth.js';
import { TastytradeRest } from './tastytrade/rest.js';
import { TradfiFeed } from './tastytrade/feed.js';
import { TradfiStore } from './runtime/store.js';
import { buildApp } from './app.js';

async function main() {
  const cfg = loadConfig();
  const auth = new OAuth2TokenManager(cfg);
  const rest = new TastytradeRest({ baseUrl: cfg.baseUrl, userAgent: cfg.userAgent }, auth);
  const store = new TradfiStore();
  const feed = new TradfiFeed(rest, store, cfg.underlyings);

  const app = buildApp({ store, feed });
  await app.listen({ port: cfg.port, host: '0.0.0.0' });
  logger.info({ port: cfg.port }, 'tradfi service listening');

  void feed.loadMarkets()
    .then(() => feed.startStreaming())
    .then(() => logger.info('markets loaded + streaming'))
    .catch((err: unknown) => logger.error({ err: String(err) }, 'bootstrap failed'));

  let shuttingDown = false;
  const shutdown = (sig: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ sig }, 'shutting down');
    void (async () => {
      try {
        await feed.dispose();
        await app.close();
      } catch (err: unknown) {
        logger.error({ err: String(err) }, 'shutdown error');
      } finally {
        process.exit(0);
      }
    })();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  logger.error({ err: String(err) }, 'fatal');
  process.exit(1);
});
