import { registerAppDocument } from '@lib/app-visibility';
import { useAppStore } from '@stores/app-store';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionTimeout } from './useSessionTimeout';

const { endSession } = vi.hoisted(() => ({ endSession: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@components/auth/AccountSessionProvider', () => ({
  useAccountSession: () => ({ endSession }),
}));

describe('multi-window session timeout', () => {
  let close = () => {};
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    useAppStore.setState({ sessionNotice: null, sessionExtendToken: 0 });
  });
  afterEach(() => {
    cleanup();
    close();
    vi.useRealTimers();
  });

  it('keeps the session active while a pop-out is visible', () => {
    const popup = document.implementation.createHTMLDocument();
    vi.spyOn(popup, 'hidden', 'get').mockReturnValue(false);
    close = registerAppDocument(popup);
    renderHook(useSessionTimeout);
    act(() => vi.advanceTimersByTime(31 * 60_000));
    expect(useAppStore.getState().sessionNotice).toBeNull();
    expect(endSession).not.toHaveBeenCalled();
  });

  it('starts warning and logout timers when every window becomes hidden', () => {
    const popup = document.implementation.createHTMLDocument();
    const hidden = vi.spyOn(popup, 'hidden', 'get').mockReturnValue(false);
    close = registerAppDocument(popup);
    renderHook(useSessionTimeout);
    act(() => {
      hidden.mockReturnValue(true);
      popup.dispatchEvent(new Event('visibilitychange'));
      vi.advanceTimersByTime(29 * 60_000);
    });
    expect(useAppStore.getState().sessionNotice?.kind).toBe('idle-warning');
    act(() => vi.advanceTimersByTime(60_000));
    expect(useAppStore.getState().sessionNotice?.kind).toBe('idle-logout');
    expect(endSession).toHaveBeenCalledOnce();
  });

  it('cancels a pending idle timer when a pop-out opens', () => {
    renderHook(useSessionTimeout);
    act(() => vi.advanceTimersByTime(20 * 60_000));
    const popup = document.implementation.createHTMLDocument();
    vi.spyOn(popup, 'hidden', 'get').mockReturnValue(false);
    act(() => {
      close = registerAppDocument(popup);
    });
    act(() => vi.advanceTimersByTime(31 * 60_000));
    expect(useAppStore.getState().sessionNotice).toBeNull();
    expect(endSession).not.toHaveBeenCalled();
  });
});
