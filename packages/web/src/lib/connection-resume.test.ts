/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { onConnectionResume } from './connection-resume';

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, value: hidden });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('onConnectionResume', () => {
  let stop: () => void = () => {};

  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  });

  afterEach(() => {
    stop();
    vi.useRealTimers();
  });

  it('fires after the page was hidden long enough for the socket to die', () => {
    const listener = vi.fn();
    stop = onConnectionResume(listener);

    setHidden(true);
    vi.advanceTimersByTime(60_000);
    setHidden(false);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('ignores a brief tab switch', () => {
    const listener = vi.fn();
    stop = onConnectionResume(listener);

    setHidden(true);
    vi.advanceTimersByTime(2_000);
    setHidden(false);

    expect(listener).not.toHaveBeenCalled();
  });

  it('fires when the network returns', () => {
    const listener = vi.fn();
    stop = onConnectionResume(listener);

    window.dispatchEvent(new Event('online'));

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('fires only for a back/forward cache restore, not a normal page show', () => {
    const listener = vi.fn();
    stop = onConnectionResume(listener);

    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }));
    expect(listener).not.toHaveBeenCalled();

    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('stops listening after cleanup', () => {
    const listener = vi.fn();
    onConnectionResume(listener)();

    window.dispatchEvent(new Event('online'));

    expect(listener).not.toHaveBeenCalled();
  });
});
