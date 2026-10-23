import { describe, expect, it } from 'vitest';
import { clusterOrder } from './cluster';

describe('clusterOrder', () => {
  it('puts correlated sectors next to each other and data-less sectors last', () => {
    // 0~2 and 1~3 move together; 4 has no data.
    const m = [
      [1, 0.1, 0.9, 0.2, null],
      [0.1, 1, 0.15, 0.85, null],
      [0.9, 0.15, 1, 0.1, null],
      [0.2, 0.85, 0.1, 1, null],
      [null, null, null, null, null],
    ];
    const order = clusterOrder(m);
    expect(order).toHaveLength(5);
    expect(order[4]).toBe(4);
    const pos = (i: number) => order.indexOf(i);
    expect(Math.abs(pos(0) - pos(2))).toBe(1);
    expect(Math.abs(pos(1) - pos(3))).toBe(1);
  });

  it('handles empty input', () => {
    expect(clusterOrder([])).toEqual([]);
  });
});
