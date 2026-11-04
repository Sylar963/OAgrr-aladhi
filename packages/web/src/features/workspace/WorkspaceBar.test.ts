import { describe, expect, it, vi } from 'vitest';

vi.mock('@components/ui/DropdownPicker', () => ({ default: () => null }));

import { reorderIndex } from './WorkspaceBar';

describe('reorderIndex', () => {
  const midpoints = [100, 200, 300];

  it('stays put while the pointer is over its own tab', () => {
    expect(reorderIndex(midpoints, 1, 190)).toBe(1);
    expect(reorderIndex(midpoints, 1, 210)).toBe(1);
  });

  it('moves right past a neighbour midpoint', () => {
    expect(reorderIndex(midpoints, 0, 210)).toBe(1);
    expect(reorderIndex(midpoints, 0, 310)).toBe(2);
  });

  it('moves left past a neighbour midpoint', () => {
    expect(reorderIndex(midpoints, 2, 190)).toBe(1);
    expect(reorderIndex(midpoints, 2, 90)).toBe(0);
  });

  it('clamps to the ends', () => {
    expect(reorderIndex(midpoints, 1, -500)).toBe(0);
    expect(reorderIndex(midpoints, 1, 5000)).toBe(2);
  });
});
