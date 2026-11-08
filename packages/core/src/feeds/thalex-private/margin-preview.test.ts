import { describe, expect, it } from 'vitest';
import { ThalexMarginPreviewRequestSchema, ThalexMarginPreviewSchema } from './margin-preview.js';

describe('Thalex margin preview contracts', () => {
  it('accepts the documented three margin views and strips unrelated private fields', () => {
    expect(
      ThalexMarginPreviewSchema.parse({
        current: { required_margin: 1_000, underlying: { underlying: 'BTC' } },
        with_buy: { required_margin: 800 },
        with_sell: { required_margin: 1_200 },
        account: 'private',
      }),
    ).toEqual({
      current: { required_margin: 1_000 },
      with_buy: { required_margin: 800 },
      with_sell: { required_margin: 1_200 },
    });
  });

  it('rejects incomplete or nonfinite margin responses instead of supplying zero', () => {
    expect(ThalexMarginPreviewSchema.safeParse({ current: { required_margin: 0 } }).success).toBe(
      false,
    );
    expect(
      ThalexMarginPreviewSchema.safeParse({
        current: { required_margin: NaN },
        with_buy: { required_margin: 0 },
        with_sell: { required_margin: 0 },
      }).success,
    ).toBe(false);
  });

  it('requires exactly one instrument specification and a positive amount', () => {
    const order = { instrument_name: 'BTC-27NOV26-75000-P', price: 120, amount: 0.1 };
    expect(ThalexMarginPreviewRequestSchema.safeParse(order).success).toBe(true);
    expect(ThalexMarginPreviewRequestSchema.safeParse({ ...order, amount: 0 }).success).toBe(false);
    expect(
      ThalexMarginPreviewRequestSchema.safeParse({
        ...order,
        legs: [
          { instrument_name: 'BTC-27NOV26-75000-P', quantity: 1 },
          { instrument_name: 'BTC-27NOV26-87000-P', quantity: -1 },
        ],
      }).success,
    ).toBe(false);
  });
});
