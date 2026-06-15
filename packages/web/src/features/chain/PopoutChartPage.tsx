import { useEffect, useMemo, useState } from 'react';
import {
  VENUE_IDS,
  type InstrumentCandleInterval,
  type InstrumentCandleRange,
  type VenueId,
} from '@oggregator/protocol';
import { VENUES } from '@lib/venue-meta';
import { useChainQuery } from './queries.js';
import { useChainWs } from '@hooks/useChainWs';
import { parsePopoutParams } from './chart-popout-url.js';
import { CHART_SUPPORTED_VENUES } from './instrument-symbol.js';
import { ChartPanelView, INTERVALS, RANGES, type ChartPanelData } from './ChartPanelView.js';
import styles from './PopoutChartPage.module.css';

function isVenueId(v: string): v is VenueId {
  return (VENUE_IDS as readonly string[]).includes(v);
}

export default function PopoutChartPage() {
  const initial = useMemo(() => parsePopoutParams(window.location.search), []);
  if (!initial || !isVenueId(initial.venue)) {
    return <div className={styles.error}>Invalid popout URL.</div>;
  }
  return <PopoutInner initial={initial as Omit<typeof initial, 'venue'> & { venue: VenueId }} />;
}

interface PopoutInnerProps {
  initial: ReturnType<typeof parsePopoutParams> extends infer R
    ? R extends null ? never : Omit<NonNullable<R>, 'venue'> & { venue: VenueId }
    : never;
}

function PopoutInner({ initial }: PopoutInnerProps) {
  const [data, setData] = useState<ChartPanelData>(() => ({
    venue: initial.venue,
    symbol: initial.symbol,
    underlying: initial.underlying,
    expiry: initial.expiry,
    strike: initial.strike,
    type: initial.type,
    interval: INTERVALS.includes(initial.interval as InstrumentCandleInterval)
      ? (initial.interval as InstrumentCandleInterval)
      : '1h',
    range: RANGES.includes(initial.range as InstrumentCandleRange)
      ? (initial.range as InstrumentCandleRange)
      : '7d',
    overlays: { mark: initial.mark, ma9: initial.ma9, ma20: initial.ma20 },
    chartMode: initial.mode,
  }));

  useEffect(() => {
    document.title = `${data.symbol} · ${VENUES[data.venue]?.shortLabel ?? data.venue}`;
  }, [data.symbol, data.venue]);

  // Fetch the chain across all chart-supported venues so the venue selector
  // can enumerate which venues quote this strike. WS stays scoped to the
  // active venue — we only need live mid for one chart at a time.
  useChainQuery(data.underlying, data.expiry, CHART_SUPPORTED_VENUES.slice());
  useChainWs({
    underlying: data.underlying,
    expiry: data.expiry,
    venues: [data.venue],
  });

  return (
    <div className={styles.root}>
      <ChartPanelView
        data={data}
        styles={styles}
        onPatch={(patch) => setData((d) => ({ ...d, ...patch }))}
        onSwitchVenue={(newVenue, newSymbol) =>
          setData((d) => ({ ...d, venue: newVenue, symbol: newSymbol }))
        }
      />
    </div>
  );
}
