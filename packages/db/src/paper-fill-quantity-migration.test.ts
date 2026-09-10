import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('paper fill quantity migration', () => {
  it('adds backward-compatible base defaults and nullable native context', async () => {
    const sql = await readFile(
      new URL('../migrations/0020_paper_fill_quantity_context.sql', import.meta.url),
      'utf8',
    );

    expect(sql).toContain("quantity_unit TEXT NOT NULL DEFAULT 'base'");
    expect(sql).toContain('contract_multiplier_base NUMERIC');
    expect(sql).toContain('native_quantity NUMERIC');
    expect(sql).toContain("CHECK (quantity_unit = 'base')");
  });

  it('provides rollback SQL outside the forward migration directory', async () => {
    const sql = await readFile(
      new URL('../rollbacks/0020_paper_fill_quantity_context.sql', import.meta.url),
      'utf8',
    );

    expect(sql).toContain('DROP COLUMN IF EXISTS native_price_tick');
    expect(sql).toContain('DROP COLUMN IF EXISTS quantity_unit');
  });
});
