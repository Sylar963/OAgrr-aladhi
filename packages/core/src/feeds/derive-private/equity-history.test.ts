import { describe, expect, it } from 'vitest';

import { deriveValueHistoryToPoints } from './codec.js';
import { DeriveSubaccountValueHistoryResponseSchema } from './types.js';

describe('deriveValueHistoryToPoints', () => {
  it('parses decimal strings, normalizes second timestamps, and sorts ascending', () => {
    const parsed = DeriveSubaccountValueHistoryResponseSchema.parse({
      subaccount_value_history: [
        { subaccount_id: 7, subaccount_value: '1250.5', initial_margin: '900', maintenance_margin: '1000', margin_type: 'PM2', currency: 'USDC', timestamp: 1_760_313_600_000 },
        { subaccount_id: 7, subaccount_value: '1100', initial_margin: '800', maintenance_margin: '900', margin_type: 'PM2', currency: 'USDC', timestamp: 1_760_227_200 },
        { subaccount_id: 7, subaccount_value: 'NaN', initial_margin: '0', maintenance_margin: '0', margin_type: 'SM', currency: '', timestamp: 1_760_140_800_000 },
      ],
      pagination: { num_pages: 1, count: 3 },
    });
    expect(deriveValueHistoryToPoints(parsed.subaccount_value_history)).toEqual([
      { ts: 1_760_227_200_000, equityUsd: 1100 },
      { ts: 1_760_313_600_000, equityUsd: 1250.5 },
    ]);
  });
});
