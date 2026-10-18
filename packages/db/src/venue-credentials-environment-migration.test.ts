import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('venue credentials environment migration', () => {
  it('keeps existing rows as the active mainnet slot and allows one active slot per venue', async () => {
    const sql = await readFile(
      new URL('../migrations/0037_venue_credentials_environment.sql', import.meta.url),
      'utf8',
    );

    expect(sql).toContain("environment TEXT NOT NULL DEFAULT 'prod'");
    expect(sql).toContain('active BOOLEAN NOT NULL DEFAULT true');
    expect(sql).toContain("CHECK (environment IN ('prod', 'test'))");
    expect(sql).toContain('PRIMARY KEY (account_id, venue, environment)');
    expect(sql).toMatch(/UNIQUE INDEX[^;]+\(account_id, venue\)\s+WHERE active/);
  });

  it('provides rollback SQL that drops testnet slots before restoring the old key', async () => {
    const sql = await readFile(
      new URL('../rollbacks/0037_venue_credentials_environment.sql', import.meta.url),
      'utf8',
    );

    expect(sql.indexOf("DELETE FROM venue_credentials WHERE environment <> 'prod'")).toBeLessThan(
      sql.indexOf('ADD PRIMARY KEY (account_id, venue)'),
    );
    expect(sql).toContain('DROP COLUMN IF EXISTS environment');
  });
});
