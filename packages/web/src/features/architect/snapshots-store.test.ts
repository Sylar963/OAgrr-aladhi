import { describe, it, expect, beforeEach } from 'vitest';
import {
  addSnapshot, listSnapshots, removeSnapshot, clearSnapshots,
  MAX_SNAPSHOTS, type GhostSnapshot,
} from './snapshots-store';

function snap(over: Partial<GhostSnapshot> = {}): GhostSnapshot {
  return {
    id: over.id ?? 'a',
    createdAt: over.createdAt ?? 1000,
    underlying: over.underlying ?? 'BTC',
    structureLabel: over.structureLabel ?? 'Long Call',
    spotAtSnapshot: over.spotAtSnapshot ?? 100,
    expiryMs: over.expiryMs ?? 9_999,
    resolutionSec: over.resolutionSec ?? 86_400,
    paths: over.paths ?? [{ kind: 'up', isProfit: true, targetPrice: 130, pnlAtExpiry: 25 }],
  };
}

describe('snapshots-store', () => {
  beforeEach(() => localStorage.clear());

  it('adds and lists newest-first', () => {
    addSnapshot(snap({ id: 'a', createdAt: 1 }));
    addSnapshot(snap({ id: 'b', createdAt: 2 }));
    expect(listSnapshots().map((s) => s.id)).toEqual(['b', 'a']);
  });

  it('filters by underlying', () => {
    addSnapshot(snap({ id: 'a', underlying: 'BTC' }));
    addSnapshot(snap({ id: 'b', underlying: 'ETH' }));
    expect(listSnapshots('ETH').map((s) => s.id)).toEqual(['b']);
  });

  it('removes by id and clears', () => {
    addSnapshot(snap({ id: 'a' }));
    addSnapshot(snap({ id: 'b' }));
    removeSnapshot('a');
    expect(listSnapshots().map((s) => s.id)).toEqual(['b']);
    clearSnapshots();
    expect(listSnapshots()).toEqual([]);
  });

  it('caps at MAX_SNAPSHOTS, dropping the oldest', () => {
    for (let i = 0; i < MAX_SNAPSHOTS + 5; i++) addSnapshot(snap({ id: `s${i}`, createdAt: i }));
    const all = listSnapshots();
    expect(all).toHaveLength(MAX_SNAPSHOTS);
    expect(all.at(-1)!.id).toBe('s5'); // s0..s4 evicted
  });

  it('returns [] on corrupt storage', () => {
    localStorage.setItem('oggregator.architect.ghostSnapshots', 'not json');
    expect(listSnapshots()).toEqual([]);
  });

  it('rejects schema-invalid rows', () => {
    localStorage.setItem('oggregator.architect.ghostSnapshots', JSON.stringify([{ id: 1 }]));
    expect(listSnapshots()).toEqual([]);
  });

  it('persists a per-path fractal shape and still loads paths without one', () => {
    addSnapshot(
      snap({
        id: 'shaped',
        paths: [
          { kind: 'up', isProfit: true, targetPrice: 130, pnlAtExpiry: 25, shape: [0, 0.1, 0] },
        ],
      }),
    );
    expect(listSnapshots()[0]!.paths[0]!.shape).toEqual([0, 0.1, 0]);
    expect(snap().paths[0]!.shape).toBeUndefined();
  });
});
