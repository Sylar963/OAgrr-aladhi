import type { IvHistoryPoint } from '@shared/enriched';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import SkewReadout from './SkewReadout';

afterEach(cleanup);

const point: IvHistoryPoint = {
  ts: 1,
  atmIv: 0.6,
  rr25d: -0.094,
  bfly25d: 0.003,
  rr10d: null,
  bfly10d: null,
};

describe('SkewReadout', () => {
  it('shows asymmetric wings separately from a positive fly near its historical low', () => {
    render(<SkewReadout point={point} percentile={0.2} tenor="30d" historyDays={30} />);
    expect(screen.getByText('+5.0vp')).toBeTruthy();
    expect(screen.getByText('-4.4vp')).toBeTruthy();
    expect(screen.getByText('+0.3vp')).toBeTruthy();
    expect(screen.getByText('Average wings 0.3vp above ATM')).toBeTruthy();
    expect(screen.getByText('Low wing premium vs history')).toBeTruthy();
    const meter = screen.getByRole('meter', {
      name: 'Wing premium percentile: 30d options, 30-day history',
    });
    expect(meter.getAttribute('aria-valuenow')).toBe('0.2');
  });

  it('changes scope and historical assessment with the selected inputs', () => {
    const { rerender } = render(
      <SkewReadout point={point} percentile={15} tenor="30d" historyDays={30} />,
    );
    expect(screen.getByText('Low wing premium vs history')).toBeTruthy();
    rerender(<SkewReadout point={point} percentile={72} tenor="7d" historyDays={90} />);
    expect(screen.getByText('7d options · 90-day history')).toBeTruthy();
    expect(screen.getByText('Typical wing premium vs history')).toBeTruthy();
    expect(screen.queryByText('Low wing premium vs history')).toBeNull();
    rerender(
      <SkewReadout
        point={{ ...point, bfly25d: -0.003 }}
        percentile={85}
        tenor="7d"
        historyDays={90}
      />,
    );
    expect(screen.getByText('High wing premium vs history')).toBeTruthy();
    expect(screen.getByText('Average wings 0.3vp below ATM')).toBeTruthy();
  });

  it('retains the average without inventing individual wings or a historical rank', () => {
    render(
      <SkewReadout
        point={{ ...point, rr25d: null }}
        percentile={null}
        tenor="30d"
        historyDays={30}
      />,
    );
    expect(screen.queryByText('Put wing')).toBeNull();
    expect(screen.queryByText('Call wing')).toBeNull();
    expect(screen.getByText('Average wings 0.3vp above ATM')).toBeTruthy();
    expect(screen.getByText('Wing history unavailable')).toBeTruthy();
    expect(screen.queryByRole('meter')).toBeNull();
  });

  it('withholds comparisons without valid ATM and fly inputs', () => {
    const { container, rerender } = render(
      <SkewReadout
        point={{ ...point, atmIv: null }}
        percentile={20}
        tenor="30d"
        historyDays={30}
      />,
    );
    expect(container.innerHTML).toBe('');
    rerender(
      <SkewReadout
        point={{ ...point, bfly25d: Number.NaN }}
        percentile={20}
        tenor="30d"
        historyDays={30}
      />,
    );
    expect(container.innerHTML).toBe('');
  });
});
