import { describe, expect, it } from 'vitest';

import { paradexAccountHistoryToPoints } from './codec.js';
import { ParadexAccountHistorySchema } from './types.js';

describe('paradexAccountHistoryToPoints', () => {
  it('zips the parallel arrays into ascending millisecond points', () => {
    const history = ParadexAccountHistorySchema.parse({
      data: [2_000, 1_900],
      timestamps: [1_760_313_600, 1_760_227_200_000],
    });
    expect(paradexAccountHistoryToPoints(history)).toEqual([
      { ts: 1_760_227_200_000, equityUsd: 1_900 },
      { ts: 1_760_313_600_000, equityUsd: 2_000 },
    ]);
  });
});
