import { useAppStore } from '@stores/app-store';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('@features/architect', () => ({
  ArchitectView: ({ market }: { market?: 'crypto' | 'tradfi' }) => (
    <div>Builder market: {market}</div>
  ),
}));

vi.mock('./queries', () => ({
  useTradfiUnderlyings: () => ({ data: { underlyings: ['SPY'] } }),
}));

vi.mock('./TradfiChainView', () => ({ default: () => <div>TradFi chain</div> }));
vi.mock('./TradfiGexView', () => ({ default: () => <div>TradFi GEX</div> }));
vi.mock('./TradfiAnalyticsView', () => ({ default: () => <div>TradFi analytics</div> }));

import TradfiApp from './TradfiApp';

afterEach(() => {
  cleanup();
  useAppStore.setState({
    assetMode: 'crypto',
    tradfiUnderlying: '',
    tradfiExpiry: '',
    tradfiPage: 'chain',
  });
});

it('opens the shared Builder in TradFi market mode', async () => {
  useAppStore.setState({
    assetMode: 'tradfi',
    tradfiUnderlying: 'SPY',
    tradfiPage: 'chain',
  });
  render(<TradfiApp />);

  fireEvent.click(screen.getByRole('tab', { name: 'Builder' }));

  expect(await screen.findByText('Builder market: tradfi')).not.toBeNull();
  expect(useAppStore.getState().tradfiPage).toBe('builder');
});

it('opens the lazy TradFi Analytics tab', async () => {
  useAppStore.setState({ assetMode: 'tradfi', tradfiUnderlying: 'SPY', tradfiPage: 'chain' });
  render(<TradfiApp />);
  fireEvent.click(screen.getByRole('tab', { name: 'Analytics' }));
  expect(await screen.findByText('TradFi analytics')).not.toBeNull();
  expect(useAppStore.getState().tradfiPage).toBe('analytics');
});
