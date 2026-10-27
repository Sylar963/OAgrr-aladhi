import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { useAppStore } from '@stores/app-store';
import GexView from './GexView';
import GexBandsChart from './GexBandsChart';

const data = vi.hoisted(() => ({
  stats: { indexPriceUsd: 80_000 as number | null, forwardPriceUsd: 84_000 },
  gex: [{ strike: 75_000, gexUsdMillions: -2 }, { strike: 90_000, gexUsdMillions: 3 }],
  gexProfile: [{ movePct: -0.1, gexUsdMillions: -2 }, { movePct: 0, gexUsdMillions: 2 }],
}));

vi.mock('@components/ui', () => ({
  AssetPickerButton: () => null,
  VenuePickerButton: () => null,
  EmptyState: () => null,
  Spinner: () => null,
}));
vi.mock('@hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('@features/chain/queries', () => ({
  useExpiries: () => ({ data: { expiries: ['2026-11-06'] } }),
  useChainQuery: () => ({ data, isLoading: false }),
  useAllExpiriesGex: () => ({ data: { ...data, spotPrice: 82_000 }, isLoading: false }),
}));
vi.mock('./GexBandsChart', () => ({
  default: vi.fn((_props: ComponentProps<typeof GexBandsChart>) => null),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  data.stats.indexPriceUsd = 80_000;
});

function mount() {
  useAppStore.setState({ underlying: 'BTC' });
  render(<GexView />);
}

describe('GexView spot reference', () => {
  it('anchors the displayed flip and chart to index rather than the expiry forward', () => {
    mount();
    expect(screen.getByText('76,000')).toBeDefined();
    expect(vi.mocked(GexBandsChart).mock.lastCall?.[0].spotPrice).toBe(80_000);
  });

  it('falls back to the forward when the index is unavailable', () => {
    data.stats.indexPriceUsd = null;
    mount();
    expect(screen.getByText('79,800')).toBeDefined();
    expect(vi.mocked(GexBandsChart).mock.lastCall?.[0].spotPrice).toBe(84_000);
  });

  it('uses the aggregate reference when all expiries are selected', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: /ALL/ }));
    expect(screen.getByText('77,900')).toBeDefined();
    expect(vi.mocked(GexBandsChart).mock.lastCall?.[0].spotPrice).toBe(82_000);
  });
});
