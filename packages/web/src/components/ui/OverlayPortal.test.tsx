import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import OverlayPortal from './OverlayPortal';
import { PanelDocumentContext } from '@lib/panel-document';
import { useState } from 'react';
import { fireEvent } from '@testing-library/react';

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
    expect(screen.getByText('overlay').parentElement?.parentElement).toBe(document.body);
    expect(screen.getByTestId('widget').textContent).toBe('');
  });

  it('stays inside the TradFi root for its theme tokens', () => {
    render(<div data-mode="tradfi" data-testid="tradfi-root" />);
    render(
      <OverlayPortal>
        <div>overlay</div>
      </OverlayPortal>,
    );
    expect(screen.getByText('overlay').parentElement?.parentElement).toBe(
      screen.getByTestId('tradfi-root'),
    );
  });

  it('ignores other elements that use data-mode', () => {
    render(<div data-mode="long_vol" />);
    render(
      <OverlayPortal>
        <div>overlay</div>
      </OverlayPortal>,
    );
    expect(screen.getByText('overlay').parentElement?.parentElement).toBe(document.body);
  });

  it('renders overlays in the panel window and follows it back to the main document', () => {
    const popup = document.implementation.createHTMLDocument();
    const content = (
      <OverlayPortal>
        <div>detached overlay</div>
      </OverlayPortal>
    );
    const view = render(
      <PanelDocumentContext.Provider value={popup}>{content}</PanelDocumentContext.Provider>,
    );
    expect(popup.body.textContent).toBe('detached overlay');
    expect(screen.queryByText('detached overlay')).toBeNull();
    view.rerender(
      <PanelDocumentContext.Provider value={document}>{content}</PanelDocumentContext.Provider>,
    );
    expect(popup.body.textContent).toBe('');
    expect(screen.getByText('detached overlay').parentElement?.parentElement).toBe(document.body);
  });

  it('preserves entered values when an open overlay moves between windows', () => {
    function Form() {
      const [value, setValue] = useState('');
      return (
        <input
          aria-label="Draft"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      );
    }
    const popup = document.implementation.createHTMLDocument();
    const content = (
      <OverlayPortal>
        <Form />
      </OverlayPortal>
    );
    const view = render(
      <PanelDocumentContext.Provider value={document}>{content}</PanelDocumentContext.Provider>,
    );
    const input = screen.getByRole('textbox', { name: 'Draft' });
    fireEvent.change(input, { target: { value: '50000' } });
    view.rerender(
      <PanelDocumentContext.Provider value={popup}>{content}</PanelDocumentContext.Provider>,
    );
    expect(popup.querySelector('input')).toBe(input);
    expect((popup.querySelector('input') as HTMLInputElement).value).toBe('50000');
    view.rerender(
      <PanelDocumentContext.Provider value={document}>{content}</PanelDocumentContext.Provider>,
    );
    expect(screen.getByRole('textbox', { name: 'Draft' })).toBe(input);
    expect((input as HTMLInputElement).value).toBe('50000');
    view.unmount();
    expect(document.querySelector('input')).toBeNull();
    expect(popup.body.childElementCount).toBe(0);
  });
});
