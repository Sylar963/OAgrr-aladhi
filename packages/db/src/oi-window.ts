import { open, type FileHandle } from 'node:fs/promises';
import {
  OiSnapshotSchema,
  type OiSnapshotQuery,
  type OiSnapshotWindow,
} from './oi-snapshot-store.js';

interface InstrumentOffsets {
  offsets: number[];
  lengths: number[];
  timestamps: number[];
}

interface IndexedOiFile {
  rows: Map<string, InstrumentOffsets>;
  invalidLines: string[];
  indexedSize: number;
  fileSize: number;
  mtimeMs: number;
  refreshing: Promise<void> | null;
}

const indexedFiles = new Map<string, IndexedOiFile>();
const MAX_INDEXED_FILES = 4;

export async function readOiWindow(
  paths: string[],
  query: OiSnapshotQuery,
): Promise<OiSnapshotWindow> {
  const rows: OiSnapshotWindow['rows'] = [];
  let complete = true;
  const instruments = new Set(query.instruments);
  if (instruments.size === 0) return { rows, complete };
  const needles = [...instruments].map((instrument) => JSON.stringify(instrument));

  for (const path of paths) {
    const handle = await open(path, 'r').catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
      throw error;
    });
    if (!handle) continue;
    let limitReached = false;
    try {
      const index = await indexFile(handle);
      if (index.invalidLines.some((line) => needles.some((needle) => line.includes(needle))))
        complete = false;

      const candidates: Array<{ offset: number; length: number }> = [];
      for (const instrument of instruments) {
        const found = index.rows.get(JSON.stringify([query.venue, instrument]));
        if (!found) continue;
        for (let i = 0; i < found.offsets.length; i++) {
          const timestamp = found.timestamps[i]!;
          if (timestamp >= query.from.getTime() && timestamp <= query.to.getTime())
            candidates.push({ offset: found.offsets[i]!, length: found.lengths[i]! });
        }
      }
      candidates.sort((a, b) => a.offset - b.offset);

      for (const candidate of candidates) {
        if (rows.length >= 4096) {
          complete = false;
          limitReached = true;
          break;
        }
        const buffer = Buffer.alloc(candidate.length);
        const { bytesRead } = await handle.read(
          buffer,
          0,
          candidate.length,
          candidate.offset,
        );
        if (bytesRead !== candidate.length) {
          complete = false;
          continue;
        }
        let value: unknown;
        try {
          value = JSON.parse(buffer.toString('utf8'));
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
        rows.push(row);
      }
    } finally {
      await handle.close();
    }
    if (limitReached) break;
  }

  return { rows, complete };
}

async function indexFile(handle: FileHandle): Promise<IndexedOiFile> {
  const initial = await handle.stat();
  // The outbox rotates by rename, so the same file keeps its index at its new path.
  const identity = `${initial.dev}:${initial.ino}:${initial.birthtimeMs}`;
  let index = indexedFiles.get(identity);
  if (!index) {
    index = {
      rows: new Map(),
      invalidLines: [],
      indexedSize: 0,
      fileSize: -1,
      mtimeMs: -1,
      refreshing: null,
    };
    indexedFiles.set(identity, index);
  } else {
    indexedFiles.delete(identity);
    indexedFiles.set(identity, index);
  }

  while (true) {
    if (index.refreshing) {
      await index.refreshing;
      continue;
    }

    const current = await handle.stat();
    const rebuild =
      current.size < index.fileSize ||
      (current.size === index.fileSize && current.mtimeMs !== index.mtimeMs);
    if (rebuild) {
      index.rows.clear();
      index.invalidLines.length = 0;
      index.indexedSize = 0;
      index.fileSize = -1;
    }
    if (!rebuild && current.size <= index.fileSize) return index;

    const start = index.indexedSize;
    const task = scanRange(handle, index, start, current.size).then(() => {
      index.fileSize = current.size;
      index.mtimeMs = current.mtimeMs;
    });
    index.refreshing = task;
    try {
      await task;
    } catch (error: unknown) {
      index.rows.clear();
      index.invalidLines.length = 0;
      index.indexedSize = 0;
      index.fileSize = -1;
      index.mtimeMs = -1;
      throw error;
    } finally {
      index.refreshing = null;
    }
    break;
  }

  while (indexedFiles.size > MAX_INDEXED_FILES) {
    const oldest = indexedFiles.keys().next().value;
    if (oldest === undefined || oldest === identity) break;
    const entry = indexedFiles.get(oldest);
    if (entry?.refreshing) break;
    indexedFiles.delete(oldest);
  }
  return index;
}

async function scanRange(
  handle: FileHandle,
  index: IndexedOiFile,
  start: number,
  size: number,
): Promise<void> {
  if (size <= start) {
    index.indexedSize = size;
    return;
  }

  const stream = handle.createReadStream({ start, end: size - 1, autoClose: false });
  let lineStart = start;
  let fragments: Buffer[] = [];
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    let cursor = 0;
    while (true) {
      const newline = bytes.indexOf(10, cursor);
      if (newline < 0) break;
      fragments.push(bytes.subarray(cursor, newline));
      const line = Buffer.concat(fragments);
      addIndexedLine(index, line, lineStart);
      lineStart += line.length + 1;
      fragments = [];
      cursor = newline + 1;
    }
    if (cursor < bytes.length) fragments.push(bytes.subarray(cursor));
  }
  if (fragments.length > 0) {
    const line = Buffer.concat(fragments);
    addIndexedLine(index, line, lineStart);
    lineStart += line.length;
  }
  index.indexedSize = lineStart;
}

function addIndexedLine(index: IndexedOiFile, line: Buffer, offset: number): void {
  const text = line.toString('utf8');
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    if (text.includes('"instrumentName"')) index.invalidLines.push(text);
    return;
  }
  const parsed = OiSnapshotSchema.safeParse(value);
  if (!parsed.success) {
    if (
      typeof value === 'object' &&
      value !== null &&
      'instrumentName' in value &&
      typeof value.instrumentName === 'string'
    )
      index.invalidLines.push(text);
    return;
  }

  const row = parsed.data;
  const key = JSON.stringify([row.venue, row.instrumentName]);
  let found = index.rows.get(key);
  if (!found) {
    found = { offsets: [], lengths: [], timestamps: [] };
    index.rows.set(key, found);
  }
  found.offsets.push(offset);
  found.lengths.push(line.length);
  found.timestamps.push(row.snapshotTs.getTime());
}
