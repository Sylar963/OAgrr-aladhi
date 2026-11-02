import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import OverlayPortal from './OverlayPortal';

describe('OverlayPortal', () => {
  afterEach(cleanup);

  it('renders into the body, outside its widget', () => {
    render(
      <div data-testid="widget">
        <OverlayPortal>
          <div>overlay</div>
        </OverlayPortal>
      </div>,
    );
    expect(screen.getByText('overlay').parentElement).toBe(document.body);
    expect(screen.getByTestId('widget').textContent).toBe('');
  });

  it('stays inside the TradFi root for its theme tokens', () => {
    render(
      <div data-mode="tradfi" data-testid="tradfi-root">
        <OverlayPortal>
          <div>overlay</div>
        </OverlayPortal>
      </div>,
    );
    expect(screen.getByText('overlay').parentElement).toBe(screen.getByTestId('tradfi-root'));
  });

  it('ignores other elements that use data-mode', () => {
    render(
      <div data-mode="long_vol">
        <OverlayPortal>
          <div>overlay</div>
        </OverlayPortal>
      </div>,
    );
    expect(screen.getByText('overlay').parentElement).toBe(document.body);
  });
});
