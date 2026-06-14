import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import SkewSmileChart from './SkewSmileChart';
import type { SmilePoint } from './skew-history-utils';

const now: SmilePoint[] = [
  { x: 0.1, iv: 49, label: '10Δp' }, { x: 0.25, iv: 44.5, label: '25Δp' },
  { x: 0.5, iv: 40, label: 'ATM' }, { x: 0.75, iv: 38.5, label: '25Δc' },
  { x: 0.9, iv: 42, label: '10Δc' },
];

describe('SkewSmileChart', () => {
  it('renders delta labels and the reference label', () => {
    render(<SkewSmileChart now={now} reference={null} referenceLabel="7d ago" />);
    expect(screen.getByText('ATM')).toBeTruthy();
    expect(screen.getByText('10Δp')).toBeTruthy();
    expect(screen.getByText('10Δc')).toBeTruthy();
  });

  it('renders an empty state with no points', () => {
    render(<SkewSmileChart now={[]} reference={null} referenceLabel="7d ago" />);
    expect(screen.getByText(/insufficient/i)).toBeTruthy();
  });
});
