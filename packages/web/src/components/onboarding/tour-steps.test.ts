import { describe, expect, it } from 'vitest';
import { TOUR_STEPS } from './tour-steps';

describe('TOUR_STEPS', () => {
  it('has 5 ordered steps', () => {
    expect(TOUR_STEPS).toHaveLength(5);
  });

  it('targets the four chrome elements in order, then a target-less wrap-up', () => {
    expect(TOUR_STEPS.map((s) => s.target)).toEqual([
      'views',
      'asset-picker',
      'venue-status',
      'account',
      undefined,
    ]);
  });

  it('every step has a title and body', () => {
    for (const step of TOUR_STEPS) {
      expect(step.title.length).toBeGreaterThan(0);
      expect(step.body.length).toBeGreaterThan(0);
    }
  });
});
