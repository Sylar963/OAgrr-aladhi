import { describe, expect, it } from 'vitest';

import { AssistantRunRegistry, hashPortfolioRef } from './assistant-run-registry.js';

const REF_A = 'pref_AAAAAAAAAAAAAAAAAAAAAA';
const REF_B = 'pref_BBBBBBBBBBBBBBBBBBBBBB';

function run(requestId: string, portfolioRef: string | null) {
  return {
    requestId,
    userIdHash: `hash-${requestId}`,
    threadId: `thread-${requestId}`,
    portfolioRef,
  };
}

describe('AssistantRunRegistry', () => {
  it('attributes by ref exactly, then by the single active run, and forgets finished runs', () => {
    const registry = new AssistantRunRegistry({ now: () => 0 });
    expect(registry.attribute(null)).toEqual({ mode: 'none' });

    registry.begin(run('r1', REF_A));
    expect(registry.attribute(REF_A)).toEqual({ mode: 'exact', requestId: 'r1' });
    expect(registry.attribute(null)).toEqual({ mode: 'single_active', requestId: 'r1' });

    registry.begin(run('r2', REF_B));
    expect(registry.attribute(REF_B)).toEqual({ mode: 'exact', requestId: 'r2' });
    expect(registry.attribute(null)).toEqual({ mode: 'ambiguous', candidateCount: 2 });

    expect(registry.finish('r1')).not.toBeNull();
    expect(registry.finish('r1')).toBeNull();
    expect(registry.attribute(REF_A)).toEqual({ mode: 'none' });
    expect(registry.activeCount).toBe(1);
  });

  it('never attributes a ref that belongs to no active run to the active run', () => {
    const registry = new AssistantRunRegistry({ now: () => 0 });
    registry.begin(run('r1', REF_A));
    expect(registry.attribute('pref_evalFixtureNotResolvable')).toEqual({ mode: 'none' });
  });

  it('evicts the oldest run when full and runs older than the TTL', () => {
    let now = 0;
    const registry = new AssistantRunRegistry({ maxActiveRuns: 2, ttlMs: 1_000, now: () => now });
    registry.begin(run('r1', REF_A));
    now = 10;
    registry.begin(run('r2', REF_B));
    registry.begin(run('r3', null));

    expect(registry.activeCount).toBe(2);
    expect(registry.attribute(REF_A)).toEqual({ mode: 'none' });
    expect(registry.finish('r1')).toBeNull();

    now = 1_010;
    expect(registry.attribute(REF_B)).toEqual({ mode: 'none' });
    expect(registry.attribute(null)).toEqual({ mode: 'none' });
    expect(registry.activeCount).toBe(0);
  });

  it('stays bounded under many runs that never finish', () => {
    const registry = new AssistantRunRegistry({ maxActiveRuns: 5, now: () => 0 });
    for (let index = 0; index < 1_000; index += 1) {
      registry.begin(run(`r${index}`, `pref_${String(index).padStart(22, '0')}`));
    }
    expect(registry.activeCount).toBe(5);
    expect(registry.attribute(`pref_${String(0).padStart(22, '0')}`)).toEqual({ mode: 'none' });
    expect(registry.attribute(`pref_${String(999).padStart(22, '0')}`)).toEqual({
      mode: 'exact',
      requestId: 'r999',
    });
  });

  it('aggregates exact and single-active tool calls into the run summary', () => {
    const registry = new AssistantRunRegistry({ now: () => 0 });
    registry.begin(run('r1', REF_A));
    const exact = registry.attribute(REF_A);
    const single = registry.attribute(null);
    registry.recordToolCall(exact, 'oggregator_evaluate_structure', 'ok');
    registry.recordToolCall(exact, 'oggregator_evaluate_structure', 'rejected_input');
    registry.recordToolCall(single, 'oggregator_option_chain', 'timeout');
    registry.recordToolCall(single, 'oggregator_news', 'failed');
    registry.recordToolCall({ mode: 'ambiguous', candidateCount: 2 }, 'oggregator_news', 'ok');
    registry.recordToolCall({ mode: 'none' }, 'oggregator_news', 'ok');
    registry.recordToolCall({ mode: 'exact', requestId: 'gone' }, 'oggregator_news', 'ok');

    expect(registry.finish('r1')).toEqual({
      total: 4,
      byTool: { oggregator_evaluate_structure: 2, oggregator_option_chain: 1, oggregator_news: 1 },
      failed: 1,
      timedOut: 1,
      rejected: 1,
      exactAttributed: 2,
    });
  });
});

describe('hashPortfolioRef', () => {
  it('returns a short stable hash that never equals or contains the raw ref', () => {
    const hash = hashPortfolioRef(REF_A);
    expect(hash).toMatch(/^[0-9a-f]{12}$/);
    expect(hash).toBe(hashPortfolioRef(REF_A));
    expect(hash).not.toBe(hashPortfolioRef(REF_B));
    expect(hash).not.toBe(REF_A);
    expect(REF_A).not.toContain(hash);
  });
});
