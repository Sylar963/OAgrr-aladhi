import { describe, expect, it } from 'vitest';

import { foldCount } from './tab-fit';

describe('foldCount', () => {
  const groups = [330, 280, 250];
  const more = () => 90;

  it('keeps every group inline when they fit', () => {
    expect(foldCount(groups, more, 860)).toBe(0);
  });

  it('folds trailing groups first, reserving room for the trigger', () => {
    expect(foldCount(groups, more, 859)).toBe(1);
    expect(foldCount(groups, more, 700)).toBe(1);
    expect(foldCount(groups, more, 699)).toBe(2);
  });

  it('folds everything when even the first group plus trigger cannot fit', () => {
    expect(foldCount(groups, more, 300)).toBe(3);
  });

  it('uses the trigger width for the fold level being tested', () => {
    const wideWhenActiveFolded = (k: number) => (k >= 2 ? 200 : 90);
    expect(foldCount(groups, wideWhenActiveFolded, 600)).toBe(3);
  });
});
