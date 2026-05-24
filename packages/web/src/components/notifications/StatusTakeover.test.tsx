/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

import type { ActiveNotice } from '@lib/system-status';
import StatusTakeover from './StatusTakeover';

const outage: ActiveNotice = {
  id: 'o1', severity: 'outage', title: 'System under maintenance', message: 'Back at 14:00 UTC', dismissible: false,
};

afterEach(() => cleanup());

describe('StatusTakeover', () => {
  it('renders a modal dialog with the title and message', () => {
    render(<StatusTakeover notice={outage} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByText('System under maintenance')).toBeTruthy();
    expect(screen.getByText('Back at 14:00 UTC')).toBeTruthy();
  });

  it('moves focus into the dialog panel on mount', () => {
    render(<StatusTakeover notice={outage} />);
    const dialog = screen.getByRole('dialog');
    const panel = dialog.querySelector('[data-severity]');
    expect(document.activeElement).toBe(panel);
  });
});
