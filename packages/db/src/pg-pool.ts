import { Pool, type PoolConfig } from 'pg';

const CONNECTION_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
]);

export function isPgConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = 'code' in error ? error.code : undefined;
  return (
    (typeof code === 'string' && CONNECTION_ERROR_CODES.has(code)) ||
    /^(Connection terminated(?: unexpectedly| due to connection timeout)?|timeout exceeded when trying to connect)$/i.test(error.message)
  );
}

/**
 * Every pool must have an 'error' listener: pg emits one when a server drops an idle client
 * (Neon does this when its compute suspends), and an unhandled pool 'error' kills the process.
 * That took the backend down on 2026-10-08 and 2026-10-14. The pool discards the dead client
 * and opens a new one on the next query, so logging is all that is needed.
 */
export function createPgPool(config: PoolConfig): Pool {
  const pool = new Pool(config);
  pool.on('error', (err) => {
    console.warn(`[pg-pool] idle client error: ${err.message}`);
  });
  return pool;
}
