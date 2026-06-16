import type { EnrichedSide } from '@shared/enriched';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ExpandedRow from './ExpandedRow';

// jsdom has no matchMedia — useIsMobile would throw.
vi.mock('@hooks/useIsMobile', () => ({ useIsMobile: () => false }));

const emptySide = { venues: {} } as unknown as EnrichedSide;

afterEach(() => cleanup());

describe('ExpandedRow chartOverride', () => {
  it('enables the Chart button and calls chartOverride for a non-VenueId chain', () => {
    const onChart = vi.fn();
    render(
      <ExpandedRow
        strike={500}
        callSide={emptySide}
        putSide={emptySide}
        myIv={null}
        activeVenues={['tastytrade']}
        atmStrike={500}
        atmConsensusForward={null}
        underlying="SPY"
        expiry="2026-06-19"
        chartOverride={onChart}
      />,
    );
    const btns = screen.getAllByRole('button', { name: /chart/i });
    expect((btns[0] as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(btns[0]!);
    expect(onChart).toHaveBeenCalledWith({
      underlying: 'SPY',
      expiry: '2026-06-19',
      strike: 500,
      type: 'call',
    });
  });

  it('keeps the Chart button disabled (crypto path unchanged) when no override and no chart venue', () => {
    render(
      <ExpandedRow
        strike={500}
        callSide={emptySide}
        putSide={emptySide}
        myIv={null}
        activeVenues={['tastytrade']}
        atmStrike={500}
        atmConsensusForward={null}
        underlying="SPY"
        expiry="2026-06-19"
      />,
    );
    const btns = screen.getAllByRole('button', { name: /chart/i });
    expect((btns[0] as HTMLButtonElement).disabled).toBe(true);
  });
});
