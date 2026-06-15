/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hasSeenOnboarding, markOnboardingSeen } from './onboarding';

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('onboarding first-run flag', () => {
  it('reports not-seen when no flag is stored', () => {
    expect(hasSeenOnboarding()).toBe(false);
  });

  it('reports seen after markOnboardingSeen()', () => {
    markOnboardingSeen();
    expect(hasSeenOnboarding()).toBe(true);
  });
});
