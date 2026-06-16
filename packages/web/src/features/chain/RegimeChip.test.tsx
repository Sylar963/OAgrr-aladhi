import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import RegimeChip from './RegimeChip';

afterEach(cleanup);

describe('RegimeChip', () => {
  it('renders all three signal dots by default', () => {
    const { getByText, queryByLabelText } = render(
      <RegimeChip basisPct={0.5} skew25d={0.02} ivChange1d={0.01} putCallOiRatio={1.2} />,
    );
    expect(getByText('B×S · B×IV · B×OI')).toBeTruthy();
    expect(queryByLabelText(/Basis × IV/)).not.toBeNull();
  });

  it('hides the IV dot when showIvSignal is false (TradFi)', () => {
    const { getByText, queryByLabelText } = render(
      <RegimeChip
        basisPct={0.5}
        skew25d={0.02}
        ivChange1d={null}
        putCallOiRatio={1.2}
        showIvSignal={false}
      />,
    );
    expect(getByText('B×S · B×OI')).toBeTruthy();
    expect(queryByLabelText(/Basis × IV/)).toBeNull();
  });
});
