import WebSocket from 'ws';
import { loadConfig } from './config.js';
import { logger } from './logger.js';
import { OAuth2TokenManager } from './tastytrade/auth.js';
import { TastytradeRest } from './tastytrade/rest.js';
import { TradfiFeed } from './tastytrade/feed.js';
import { TradfiStore } from './runtime/store.js';
import { buildApp } from './app.js';
import { CandleClient, type CandleSocket } from './tastytrade/candle-client.js';
import { buildKeepalive } from './tastytrade/codec.js';

function wsCandleSocket(url: string): CandleSocket {
  const ws = new WebSocket(url);
  const ka = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(buildKeepalive()));
  }, 20_000);
  return {
    send: (m: unknown) => ws.send(JSON.stringify(m)),
    onMessage: (cb: (m: unknown) => void) => ws.on('message', (raw) => {
      try { cb(JSON.parse(raw.toString())); } catch { /* ignore bad frames */ }
    }),
    onClose: (cb: () => void) => ws.on('close', () => { clearInterval(ka); cb(); }),
    close: () => { clearInterval(ka); ws.close(); },
  };
}

async function main() {
  const cfg = loadConfig();
  const auth = new OAuth2TokenManager(cfg);
  const rest = new TastytradeRest({ baseUrl: cfg.baseUrl, userAgent: cfg.userAgent }, auth);
  const store = new TradfiStore();
  const feed = new TradfiFeed(rest, store, cfg.underlyings);

  const candleClient = new CandleClient({
    getToken: () => rest.getQuoteToken().then((t) => ({ token: t.token, dxlinkUrl: t.dxlinkUrl })),
    socketFactory: wsCandleSocket,
  });

  const app = buildApp({ store, feed, candleClient });
  await app.listen({ port: cfg.port, host: '0.0.0.0' });
  logger.info({ port: cfg.port }, 'tradfi service listening');

  void feed.loadMarkets()
    .then(() => feed.startStreaming())
    .then(() => {
      logger.info('markets loaded + streaming');
      void candleClient.connect().catch((err: unknown) =>
        logger.error({ err: String(err) }, 'candle client connect failed'),
      );
    })
    .catch((err: unknown) => logger.error({ err: String(err) }, 'bootstrap failed'));

  let shuttingDown = false;
  const shutdown = (sig: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ sig }, 'shutting down');
    void (async () => {
      try {
        candleClient.dispose();
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
