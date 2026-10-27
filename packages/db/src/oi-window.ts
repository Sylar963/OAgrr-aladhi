import { open } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import {
  OiSnapshotSchema,
  type OiSnapshotQuery,
  type OiSnapshotWindow,
} from './oi-snapshot-store.js';

export async function readOiWindow(
  paths: string[],
  query: OiSnapshotQuery,
): Promise<OiSnapshotWindow> {
  const rows: OiSnapshotWindow['rows'] = [];
  let complete = true;
  const instruments = new Set(query.instruments);
  const needles = query.instruments.map((instrument) => JSON.stringify(instrument));
  for (const path of paths) {
    const handle = await open(path, 'r').catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
      throw error;
    });
    if (!handle) continue;
    const lines = createInterface({ input: handle.createReadStream(), crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        if (!needles.some((needle) => line.includes(needle))) continue;
        let value: unknown;
        try {
          value = JSON.parse(line);
        } catch {
          complete = false;
          continue;
        }
        const parsed = OiSnapshotSchema.safeParse(value);
        if (!parsed.success) {
          complete = false;
          continue;
        }
        const row = parsed.data;
        if (
          row.venue !== query.venue ||
          !instruments.has(row.instrumentName) ||
          row.snapshotTs < query.from ||
          row.snapshotTs > query.to
        )
          continue;
        if (rows.length >= 4096) {
          complete = false;
          break;
        }
        rows.push(row);
      }
    } finally {
      lines.close();
      await handle.close();
    }
  }
  return { rows, complete };
}
