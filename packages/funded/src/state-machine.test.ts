import { describe, expect, it } from 'vitest';
import { assertTransition, canTransition } from './state-machine.js';

describe('funded run state machine', () => {
  it('allows test route progression', () => {
    expect(canTransition('test_active', 'test_passed')).toBe(true);
    expect(canTransition('test_active', 'test_failed')).toBe(true);
    expect(canTransition('test_passed', 'funded_active')).toBe(true);
  });
  it('allows funded termination', () => {
    expect(canTransition('funded_active', 'breached')).toBe(true);
    expect(canTransition('funded_active', 'withdrawn')).toBe(true);
  });
  it('rejects illegal jumps', () => {
    expect(canTransition('test_active', 'funded_active')).toBe(false);
    expect(canTransition('test_failed', 'funded_active')).toBe(false);
    expect(canTransition('breached', 'funded_active')).toBe(false);
    expect(canTransition('withdrawn', 'breached')).toBe(false);
  });
  it('assertTransition throws on illegal transition', () => {
    expect(() => assertTransition('test_active', 'funded_active')).toThrow(
      /illegal funded run transition/i,
    );
  });
  it('assertTransition is silent on legal transition', () => {
    expect(() => assertTransition('funded_active', 'withdrawn')).not.toThrow();
  });
});
