import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readOiWindow } from './oi-window.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const instrumentName = 'BTC/USD:BTC-261030-80000-C';
const row = {
  venue: 'deribit',
  underlying: 'BTC',
  instrumentName,
  expiry: '2026-10-30',
  strike: 80000,
  optionType: 'call',
  openInterest: 100,
  snapshotTs: '2026-10-26T12:00:00.000Z',
};
const query = {
  venue: 'deribit',
  instruments: [instrumentName],
  from: new Date('2026-10-26T11:00:00Z'),
  to: new Date('2026-10-26T13:00:00Z'),
};

describe('pending OI window reader', () => {
  it('reads pending and flushing rows while excluding other venues, instruments and times', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'oi-window-'));
    dirs.push(dir);
    const path = join(dir, 'oi.ndjson');
    writeFileSync(
      path,
      [
        row,
        { ...row, venue: 'okx' },
        { ...row, instrumentName: 'BTC/USD:USDC-261030-80000-C' },
        { ...row, snapshotTs: '2026-10-25T12:00:00Z' },
      ]
        .map((item) => JSON.stringify(item))
        .join('\n') + '\n',
    );
    writeFileSync(
      `${path}.flushing`,
      JSON.stringify({ ...row, openInterest: 110, snapshotTs: '2026-10-26T12:15:00Z' }) + '\n',
    );
    const result = await readOiWindow([path, `${path}.flushing`, `${path}.missing`], query);
    expect(result.complete).toBe(true);
    expect(result.rows.map((item) => item.openInterest)).toEqual([100, 110]);
  });
  it('does not treat a corrupt matching row as complete coverage', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'oi-window-'));
    dirs.push(dir);
    const path = join(dir, 'oi.ndjson');
    writeFileSync(path, JSON.stringify({ ...row, openInterest: -1 }) + '\n');
    expect(await readOiWindow([path], query)).toEqual({ rows: [], complete: false });
  });
});
