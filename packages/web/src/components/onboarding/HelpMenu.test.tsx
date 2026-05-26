/**
 * @vitest-environment jsdom
 */

import { useAppStore } from '@stores/app-store';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HelpMenu from './HelpMenu';

beforeEach(() => {
  useAppStore.setState({ tourActive: false, tourStep: 0 });
});
afterEach(() => cleanup());

describe('HelpMenu', () => {
  it('opens the menu when the "?" button is clicked', () => {
    render(<HelpMenu onOpenShortcuts={() => {}} />);
    expect(screen.queryByText('Take the tour')).toBeNull();
    fireEvent.click(screen.getByLabelText('Help'));
    expect(screen.getByText('Take the tour')).toBeTruthy();
  });

  it('"Take the tour" starts the tour and closes the menu', () => {
    render(<HelpMenu onOpenShortcuts={() => {}} />);
    fireEvent.click(screen.getByLabelText('Help'));
    fireEvent.click(screen.getByText('Take the tour'));
    expect(useAppStore.getState().tourActive).toBe(true);
    expect(screen.queryByText('Take the tour')).toBeNull();
  });

  it('"Keyboard shortcuts" calls onOpenShortcuts and closes the menu', () => {
    const onOpenShortcuts = vi.fn();
    render(<HelpMenu onOpenShortcuts={onOpenShortcuts} />);
    fireEvent.click(screen.getByLabelText('Help'));
    fireEvent.click(screen.getByText(/Keyboard shortcuts/));
    expect(onOpenShortcuts).toHaveBeenCalledOnce();
    expect(screen.queryByText(/Keyboard shortcuts/)).toBeNull();
  });

  it('Esc closes the menu', () => {
    render(<HelpMenu onOpenShortcuts={() => {}} />);
    fireEvent.click(screen.getByLabelText('Help'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('Take the tour')).toBeNull();
  });
});
