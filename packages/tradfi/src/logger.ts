import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'tradfi' },
});

export function feedLogger(component: string) {
  return logger.child({ component });
}
