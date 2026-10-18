import { describe, expect, it } from 'vitest';
import {
  isOrderId,
  isValidThalexLabel,
  newOrderId,
  ORDER_LABEL_PREFIX,
  orderIdFromLabel,
  orderLabel,
} from './ids.js';

describe('order ids and labels', () => {
  it('creates time-ordered UUIDv7 ids', () => {
    const early = newOrderId(1_760_000_000_000);
    const late = newOrderId(1_760_000_000_001);
    expect(isOrderId(early)).toBe(true);
    expect(early < late).toBe(true);
    expect(early.slice(0, 13)).toBe('0199c82c-c000');
  });

  it('round-trips every id through a label that fits Thalex limits', () => {
    for (let i = 0; i < 500; i += 1) {
      const id = newOrderId();
      const label = orderLabel(id);
      expect(label).toHaveLength(26);
      expect(isValidThalexLabel(label)).toBe(true);
      expect(orderIdFromLabel(label)).toBe(id);
    }
  });

  it('handles the extreme ids', () => {
    const smallest = '00000000-0000-7000-8000-000000000000';
    const largest = 'ffffffff-ffff-7fff-bfff-ffffffffffff';
    expect(orderIdFromLabel(orderLabel(smallest))).toBe(smallest);
    expect(orderIdFromLabel(orderLabel(largest))).toBe(largest);
  });

  it('does not claim labels it did not write', () => {
    expect(orderIdFromLabel(undefined)).toBeNull();
    expect(orderIdFromLabel(12345)).toBeNull();
    expect(orderIdFromLabel('manual-ui-order')).toBeNull();
    expect(orderIdFromLabel(`${ORDER_LABEL_PREFIX}short`)).toBeNull();
    expect(orderIdFromLabel(`${ORDER_LABEL_PREFIX}${'z'.repeat(22)}`)).toBeNull();
    expect(orderIdFromLabel(`${ORDER_LABEL_PREFIX}${'0'.repeat(21)}!`)).toBeNull();
  });

  it('rejects labels Thalex would refuse', () => {
    expect(isValidThalexLabel('a'.repeat(33))).toBe(false);
    expect(isValidThalexLabel('has space')).toBe(false);
    expect(isValidThalexLabel('ogg_<ok>|fine-1')).toBe(true);
    expect(() => orderLabel('not-a-uuid')).toThrow();
  });
});
