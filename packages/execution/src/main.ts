import pino from 'pino';
import { loadConfig } from './config.js';
import { startDaemon } from './daemon.js';

const config = loadConfig(process.env);
const log = pino({
  level: config.logLevel,
  redact: { paths: ['*.privateKeyPem', '*.token', '*.authorization', '*.apiKey', '*.botToken'] },
});

try {
  const daemon = await startDaemon(config, log);
  const shutdown = (signal: string) => {
    daemon
      .stop(signal)
      .then(() => process.exit(0))
      .catch((err) => {
        log.error({ err }, 'shutdown failed');
        process.exit(1);
      });
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
} catch (err) {
  log.fatal({ err }, 'execution daemon failed to start');
  process.exit(1);
}
