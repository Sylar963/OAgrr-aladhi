import { Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createPgPool } from './pg-pool.js';

describe('createPgPool', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs an idle-client error instead of throwing it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pool = createPgPool({ connectionString: 'postgres://localhost:1/none' });
    expect(() => pool.emit('error', new Error('Connection terminated unexpectedly'))).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Connection terminated unexpectedly'));
    await pool.end();
  });

  it('a bare pool would have crashed the process', async () => {
    const pool = new Pool({ connectionString: 'postgres://localhost:1/none' });
    expect(() => pool.emit('error', new Error('boom'))).toThrow('boom');
    await pool.end();
  });
});
