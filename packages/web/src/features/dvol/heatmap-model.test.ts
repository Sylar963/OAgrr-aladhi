import type { VolHeatmapColumn } from '@oggregator/protocol';
import { describe, expect, it } from 'vitest';

import { heatColor, heatScaleMax, mergeHeatmapTail, walls, weightedIvRange } from './heatmap-model';

const column = (t: number, cells: VolHeatmapColumn['cells'] = []): VolHeatmapColumn => ({
  t,
  dvol: null,
  cells,
  adjCells: [],
  atmMid: null,
  trades: [],
});

describe('mergeHeatmapTail', () => {
  it('replaces the re-sent slot and trims columns that left the window', () => {
    const prev = [column(0), column(60), column(120, [[148, 1, 0]])];
    const next = [column(120, [[148, 9, 0]]), column(180)];
    const merged = mergeHeatmapTail(prev, next, 60);
    expect(merged.map((c) => c.t)).toEqual([60, 120, 180]);
    expect(merged[1]!.cells).toEqual([[148, 9, 0]]);
  });

  it('keeps everything when the poll returned nothing new', () => {
    expect(mergeHeatmapTail([column(0), column(60)], [], 0)).toHaveLength(2);
  });
});

describe('heatScaleMax', () => {
  it('uses a high percentile of the chosen side, ignoring empty cells', () => {
    const cols = [column(0, [[140, 10, 0], [141, 20, 5], [142, 0, 1000]])];
    expect(heatScaleMax(cols, 'bids', 'raw', 0.5)).toBe(20);
    expect(heatScaleMax(cols, 'asks', 'raw', 0.99)).toBe(1000);
    expect(heatScaleMax([], 'all')).toBe(1);
  });

  it('reads the skew-adjusted cells in skew view', () => {
    const cols = [{ ...column(0, [[140, 10, 0]]), adjCells: [[139, 70, 0]] as VolHeatmapColumn['cells'] }];
    expect(heatScaleMax(cols, 'bids', 'skew')).toBe(70);
  });
});

describe('weightedIvRange', () => {
  it('drops thin tails so far-off stale levels do not set the scale', () => {
    const cells: VolHeatmapColumn['cells'] = [
      [26, 5, 0],
      [144, 500, 0],
      [148, 500, 500],
      [152, 0, 500],
      [980, 0, 5],
    ];
    expect(weightedIvRange(cells, 0.25)).toEqual({ low: 36, high: 38 });
    expect(weightedIvRange([], 0.25)).toBeNull();
  });
});

describe('walls', () => {
  it('finds the largest level per side', () => {
    const c = column(0, [[144, 300, 0], [146, 900, 10], [152, 0, 700]]);
    expect(walls(c, 0.25)).toEqual({ bid: [36.5, 900], ask: [38, 700] });
  });

  it('uses the adjusted cells in skew view', () => {
    const c = { ...column(0, [[144, 300, 0]]), adjCells: [[142, 50, 0], [150, 0, 60]] as VolHeatmapColumn['cells'] };
    expect(walls(c, 0.25, 'skew')).toEqual({ bid: [35.5, 50], ask: [37.5, 60] });
  });
});

describe('heatColor', () => {
  it('is transparent for negligible values and saturates at the ceiling', () => {
    expect(heatColor(0)).toBeNull();
    expect(heatColor(1)).toBe('rgba(255, 255, 255, 1.00)');
    expect(heatColor(5)).toBe(heatColor(1));
  });
});
