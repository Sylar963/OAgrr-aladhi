import { Pool, type PoolConfig } from 'pg';

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
