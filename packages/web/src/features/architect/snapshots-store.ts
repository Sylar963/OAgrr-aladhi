import { z } from 'zod';

const STORAGE_KEY = 'oggregator.architect.ghostSnapshots';
export const MAX_SNAPSHOTS = 50;

const GhostPathSnapshotSchema = z.object({
  kind: z.enum(['up', 'down', 'theta']),
  isProfit: z.boolean(),
  targetPrice: z.number(),
  pnlAtExpiry: z.number(),
});

const GhostSnapshotSchema = z.object({
  id: z.string(),
  createdAt: z.number(),
  underlying: z.string(),
  structureLabel: z.string(),
  spotAtSnapshot: z.number(),
  expiryMs: z.number(),
  resolutionSec: z.number(),
  paths: z.array(GhostPathSnapshotSchema),
});

export type GhostSnapshot = z.infer<typeof GhostSnapshotSchema>;

const GhostSnapshotArraySchema = z.array(GhostSnapshotSchema);

function read(): GhostSnapshot[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = GhostSnapshotArraySchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

function write(snapshots: GhostSnapshot[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshots));
  } catch {
    // localStorage unavailable / quota exceeded — degrade to session-only silently.
  }
}

export function listSnapshots(underlying?: string): GhostSnapshot[] {
  const all = read().sort((a, b) => b.createdAt - a.createdAt);
  return underlying ? all.filter((s) => s.underlying === underlying) : all;
}

export function addSnapshot(snapshot: GhostSnapshot): GhostSnapshot[] {
  const next = [snapshot, ...read()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_SNAPSHOTS);
  write(next);
  return next;
}

export function removeSnapshot(id: string): GhostSnapshot[] {
  const next = read().filter((s) => s.id !== id);
  write(next);
  return next;
}

export function clearSnapshots(): void {
  write([]);
}
