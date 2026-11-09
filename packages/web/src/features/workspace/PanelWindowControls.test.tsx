import { MAIN_MARKET_ID, useAppStore } from '@stores/app-store';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { DockviewApi, IDockviewHeaderActionsProps } from 'dockview-react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import PanelWindowControls, { dockPopoutWindow } from './PanelWindowControls';

function controls() {
  const first = { id: 'chain-table', title: 'Chain table' };
  const second = { id: 'chain-stats', title: 'Chain stats' };
  const group = { panels: [first, second] };
  const addPopoutGroup = vi.fn().mockResolvedValue(true);
  const props = {
    activePanel: first,
    group,
    location: { type: 'grid' },
    containerApi: { addPopoutGroup },
  } as unknown as IDockviewHeaderActionsProps;
  return { props, first, group, addPopoutGroup };
}

describe('PanelWindowControls', () => {
  afterEach(cleanup);

  it('detaches the active panel rather than duplicating its widget', async () => {
    const { props, first, addPopoutGroup } = controls();
    render(<PanelWindowControls {...props} />);
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Pop out Chain table' })),
    );
    expect(addPopoutGroup).toHaveBeenCalledWith(
      first,
      expect.objectContaining({
        position: expect.objectContaining({ width: 1100, height: 760 }),
      }),
    );
  });

  it('can detach the whole tabbed group', async () => {
    const { props, group, addPopoutGroup } = controls();
    render(<PanelWindowControls {...props} />);
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Pop out this group' })),
    );
    expect(addPopoutGroup).toHaveBeenCalledWith(group, expect.anything());
  });

  it('prevents duplicate opens and allows retry after a blocked pop-up', async () => {
    const { props, addPopoutGroup } = controls();
    let finish = (_value: boolean) => {};
    addPopoutGroup.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    render(<PanelWindowControls {...props} />);
    const button = screen.getByRole('button', { name: 'Pop out Chain table' }) as HTMLButtonElement;
    fireEvent.click(button);
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(addPopoutGroup).toHaveBeenCalledTimes(1);
    await act(async () => finish(false));
    expect(button.disabled).toBe(false);
  });

  it('shows a live workspace binding in the detached window', () => {
    useAppStore.setState({ activeMarketId: MAIN_MARKET_ID });
    useAppStore.getState().setUnderlying('BTC');
    const { props } = controls();
    render(
      <PanelWindowControls {...props} location={{ type: 'popout', getWindow: () => window }} />,
    );
    expect(screen.getByText('BTC · Workspace')).toBeDefined();
    act(() => useAppStore.getState().setUnderlying('ETH'));
    expect(screen.getByText('ETH · Workspace')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Dock back' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Pop out Chain table' })).toBeNull();
  });

  it('docks every split group in that window, leaving other windows alone', () => {
    const target = {} as Window;
    const other = {} as Window;
    const makeGroup = (type: 'grid' | 'popout', owner: Window) => ({
      api: { location: { type }, getWindow: () => owner, moveTo: vi.fn() },
    });
    const groups = [
      makeGroup('popout', target),
      makeGroup('popout', target),
      makeGroup('popout', other),
      makeGroup('grid', window),
    ];
    dockPopoutWindow({ groups } as unknown as DockviewApi, target);
    expect(groups[0]!.api.moveTo).toHaveBeenCalledWith({ position: 'right' });
    expect(groups[1]!.api.moveTo).toHaveBeenCalledWith({ position: 'right' });
    expect(groups[2]!.api.moveTo).not.toHaveBeenCalled();
    expect(groups[3]!.api.moveTo).not.toHaveBeenCalled();
  });
});
