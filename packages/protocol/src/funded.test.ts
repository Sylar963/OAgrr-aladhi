import { describe, expect, it } from 'vitest';
import { StartFundedRunRequestSchema } from './funded.js';

describe('StartFundedRunRequestSchema', () => {
  it('accepts a test-route request with deposit', () => {
    const parsed = StartFundedRunRequestSchema.parse({
      templateId: 'tmpl_1',
      depositUsd: 500,
    });
    expect(parsed.templateId).toBe('tmpl_1');
    expect(parsed.depositUsd).toBe(500);
  });

  it('accepts an instant-route request without deposit', () => {
    const parsed = StartFundedRunRequestSchema.parse({ templateId: 'tmpl_2' });
    expect(parsed.depositUsd).toBeUndefined();
  });

  it('rejects a missing template id', () => {
    expect(() => StartFundedRunRequestSchema.parse({ depositUsd: 100 })).toThrow();
  });

  it('rejects a non-positive deposit', () => {
    expect(() =>
      StartFundedRunRequestSchema.parse({ templateId: 'tmpl_1', depositUsd: 0 }),
    ).toThrow();
  });
});
