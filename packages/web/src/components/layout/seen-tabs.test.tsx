import type { TabId } from '@lib/tabs';
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useSeenTabs } from './seen-tabs';

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

describe('useSeenTabs', () => {
  it('records the active tab and persists it across mounts', () => {
    const { result, rerender } = renderHook(({ tab }: { tab: TabId }) => useSeenTabs(tab), {
      initialProps: { tab: 'chain' },
    });
    expect(result.current.has('chain')).toBe(true);
    expect(result.current.has('alpha')).toBe(false);

    rerender({ tab: 'alpha' });
    expect(result.current.has('alpha')).toBe(true);

    const remount = renderHook(() => useSeenTabs('chain'));
    expect(remount.result.current.has('alpha')).toBe(true);
  });

  it('ignores corrupt storage', () => {
    localStorage.setItem('ogg.seenTabs', '{not json');
    const { result } = renderHook(() => useSeenTabs('news'));
    expect(result.current.has('news')).toBe(true);
  });
});
