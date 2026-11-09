import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAppVisible, registerAppDocument, subscribeAppVisibility } from './app-visibility';

describe('application visibility', () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it('stays visible when the main window is hidden and a pop-out is visible', () => {
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    const popup = document.implementation.createHTMLDocument();
    vi.spyOn(popup, 'hidden', 'get').mockReturnValue(false);
    expect(isAppVisible()).toBe(false);
    const stop = registerAppDocument(popup);
    expect(isAppVisible()).toBe(true);
    stop();
    expect(isAppVisible()).toBe(false);
  });

  it('notifies visibility consumers when windows open, hide or close', () => {
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    const popup = document.implementation.createHTMLDocument();
    const hidden = vi.spyOn(popup, 'hidden', 'get').mockReturnValue(false);
    const visible: boolean[] = [];
    cleanups.push(subscribeAppVisibility(() => visible.push(isAppVisible())));
    const close = registerAppDocument(popup);
    hidden.mockReturnValue(true);
    popup.dispatchEvent(new Event('visibilitychange'));
    close();
    expect(visible).toEqual([true, false, false]);
    popup.dispatchEvent(new Event('visibilitychange'));
    expect(visible).toHaveLength(3);
  });

  it('stops listening after the visibility consumer unmounts', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAppVisibility(listener);
    unsubscribe();
    document.dispatchEvent(new Event('visibilitychange'));
    expect(listener).not.toHaveBeenCalled();
  });
});
