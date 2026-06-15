import { describe, expect, it } from 'vitest';
import { shouldBlockApiRequestWhileBootstrapping } from './index.js';

describe('route bootstrap gate', () => {
  it('keeps readiness endpoints available during bootstrap', () => {
    expect(shouldBlockApiRequestWhileBootstrapping('/api/health')).toBe(false);
    expect(shouldBlockApiRequestWhileBootstrapping('/api/ready')).toBe(false);
  });

  it('blocks non-readiness api routes during bootstrap', () => {
    expect(shouldBlockApiRequestWhileBootstrapping('/api/chains')).toBe(true);
    expect(shouldBlockApiRequestWhileBootstrapping('/api/spots')).toBe(true);
  });

  it('ignores non-api routes', () => {
    expect(shouldBlockApiRequestWhileBootstrapping('/ws/chain')).toBe(false);
    expect(shouldBlockApiRequestWhileBootstrapping('/')).toBe(false);
  });
});
