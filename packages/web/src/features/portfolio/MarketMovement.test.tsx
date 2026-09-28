import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MovementTracker } from './MarketMovement';

afterEach(cleanup);
const row = { expiry: '2026-12-25', dte: 30, atm: 0.5, delta25c: 0.48, delta25p: 0.52 };

describe('MovementTracker', () => {
  it('keeps the captured reference fixed while live IV and risk reversal move, then resets it', () => {
    const view = render(<MovementTracker row={row} receivedAt={1000} available />);
    expect(screen.queryByRole('img')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Set baseline' }));
    view.rerender(<MovementTracker row={{ ...row, atm: 0.53, delta25c: 0.5 }} receivedAt={2000} available />);
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('ATM +3.00, risk reversal +2.00');
    expect(screen.getByText(/Baseline ATM 50.00%/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reset baseline' }));
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('ATM 0.00, risk reversal 0.00');
  });

  it('hides movement for missing data and resumes against the same baseline', () => {
    const view = render(<MovementTracker row={row} receivedAt={1000} available />);
    fireEvent.click(screen.getByRole('button', { name: 'Set baseline' }));
    view.rerender(<MovementTracker row={{ ...row, atm: null }} receivedAt={2000} available />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByRole('button').hasAttribute('disabled')).toBe(true);
    view.rerender(<MovementTracker row={{ ...row, atm: 0.49 }} receivedAt={3000} available />);
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('ATM -1.00');
    view.rerender(<MovementTracker row={row} receivedAt={3000} available={false} />);
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('starts a new reference when the selected market changes', () => {
    const view = render(<MovementTracker key="first" row={row} receivedAt={1000} available />);
    fireEvent.click(screen.getByRole('button', { name: 'Set baseline' }));
    view.rerender(<MovementTracker key="second" row={row} receivedAt={1000} available />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByRole('button', { name: 'Set baseline' })).toBeTruthy();
  });
});
