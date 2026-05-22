import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { VENUE_IDS, type InstrumentCandleInterval, type InstrumentCandleRange, type VenueId } from '@oggregator/protocol';
import type { EnrichedChainResponse } from '@shared/enriched';
import { VENUES } from '@lib/venue-meta';
import { useChainQuery } from './queries.js';
import { useChainWs } from '@hooks/useChainWs';
import { useInstrumentCandles, useLiveMidFromChain } from './use-instrument-candles.js';
import { useCandleCountdown } from './candle-countdown.js';
import { useInstrumentAttribution } from './use-instrument-attribution.js';
import InstrumentChart from './InstrumentChart.js';
import InstrumentAttributionChart from './InstrumentAttributionChart.js';
import { AttributionSummary } from './AttributionSummary.js';
import { parsePopoutParams } from './chart-popout-url.js';
import {
  CHART_SUPPORTED_VENUES,
  isChartSupportedVenue,
  NotSupportedVenueError,
  toVenueSymbol,
} from './instrument-symbol.js';
import styles from './PopoutChartPage.module.css';

const INTERVALS: InstrumentCandleInterval[] = ['1m', '5m', '15m', '1h', '4h', '1d'];
const RANGES: InstrumentCandleRange[] = ['1d', '7d', '30d', 'max'];

function isVenueId(v: string): v is VenueId {
  return (VENUE_IDS as readonly string[]).includes(v);
}

function useStrikeVenues(underlying: string, expiry: string, strike: number, type: 'call' | 'put'): VenueId[] {
  const qc = useQueryClient();
  const entries = qc.getQueriesData<EnrichedChainResponse>({ queryKey: ['chain', underlying, expiry] });
  for (const [, data] of entries) {
    if (!data) continue;
    const row = data.strikes.find((s) => s.strike === strike);
    if (!row) continue;
    const side = type === 'call' ? row.call : row.put;
    return (Object.keys(side.venues) as VenueId[]).filter(isChartSupportedVenue);
  }
  return [];
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
  const [venue, setVenue] = useState<VenueId>(initial.venue);
  const [symbol, setSymbol] = useState<string>(initial.symbol);
  const [interval, setIntervalState] = useState<InstrumentCandleInterval>(
    INTERVALS.includes(initial.interval as InstrumentCandleInterval)
      ? (initial.interval as InstrumentCandleInterval)
      : '1h',
  );
  const [range, setRangeState] = useState<InstrumentCandleRange>(
    RANGES.includes(initial.range as InstrumentCandleRange)
      ? (initial.range as InstrumentCandleRange)
      : '7d',
  );
  const [overlays, setOverlays] = useState({
    mark: initial.mark,
    ma9: initial.ma9,
    ma20: initial.ma20,
  });
  const [mode, setMode] = useState<'price' | 'attribution'>(initial.mode);

  useEffect(() => {
    document.title = `${symbol} · ${VENUES[venue]?.shortLabel ?? venue}`;
  }, [symbol, venue]);

  // Fetch the chain across all chart-supported venues so the venue selector
  // can enumerate which venues quote this strike. WS stays scoped to the
  // active venue — we only need live mid for one chart at a time.
  useChainQuery(initial.underlying, initial.expiry, CHART_SUPPORTED_VENUES.slice());
  useChainWs({
    underlying: initial.underlying,
    expiry: initial.expiry,
    venues: [venue],
  });

  const strikeVenues = useStrikeVenues(initial.underlying, initial.expiry, initial.strike, initial.type);

  const liveMid = useLiveMidFromChain(
    initial.underlying, initial.expiry, initial.strike, initial.type, venue,
  );
  const { candles, markLine, isLoading, error, priceCurrency } = useInstrumentCandles({
    venue,
    symbol,
    interval,
    range,
    liveMid,
  });
  const attribution = useInstrumentAttribution({
    venue,
    symbol,
    interval,
    range,
    underlying: initial.underlying,
    strike: initial.strike,
    right: initial.type,
    expiry: initial.expiry,
    enabled: mode === 'attribution',
  });
  const countdown = useCandleCountdown(interval);

  function switchVenue(nextVenue: VenueId): void {
    if (nextVenue === venue) return;
    try {
      const nextSymbol = toVenueSymbol({
        venue: nextVenue,
        underlying: initial.underlying,
        expiry: initial.expiry,
        strike: initial.strike,
        type: initial.type,
      });
      setVenue(nextVenue);
      setSymbol(nextSymbol);
    } catch (err) {
      if (err instanceof NotSupportedVenueError) return;
      throw err;
    }
  }

  return (
    <div className={styles.root}>
      <div className={styles.titlebar}>
        <span className={styles.title}>
          {symbol}
          <span className={styles.venueLabel}> · {VENUES[venue]?.shortLabel ?? venue}</span>
          {priceCurrency && (
            <span className={styles.venueLabel}> · {priceCurrency}</span>
          )}
        </span>
      </div>
      <div className={styles.toolbar}>
        <div className={styles.modes}>
          <button
            type="button"
            data-active={mode === 'price' || undefined}
            onClick={() => setMode('price')}
          >Price</button>
          <button
            type="button"
            data-active={mode === 'attribution' || undefined}
            onClick={() => setMode('attribution')}
          >Attribution</button>
        </div>
        <div className={styles.intervals}>
          {INTERVALS.map((i) => (
            <button
              key={i}
              type="button"
              data-active={interval === i || undefined}
              onClick={() => setIntervalState(i)}
            >{i}</button>
          ))}
          <span className={styles.countdown} title={`Next ${interval} bar closes in ${countdown}`}>
            {countdown}
          </span>
        </div>
        <div className={styles.ranges}>
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              data-active={range === r || undefined}
              onClick={() => setRangeState(r)}
            >{r}</button>
          ))}
        </div>
        <div className={styles.overlays}>
          <button
            type="button"
            data-active={overlays.mark || undefined}
            onClick={() => setOverlays((o) => ({ ...o, mark: !o.mark }))}
          >Mark</button>
          <button
            type="button"
            data-active={overlays.ma9 || undefined}
            onClick={() => setOverlays((o) => ({ ...o, ma9: !o.ma9 }))}
          >MA9</button>
          <button
            type="button"
            data-active={overlays.ma20 || undefined}
            onClick={() => setOverlays((o) => ({ ...o, ma20: !o.ma20 }))}
          >MA20</button>
        </div>
        {strikeVenues.length > 0 && (
          <div className={styles.venueDots}>
            {strikeVenues.map((v) => (
              <button
                key={v}
                type="button"
                data-active={venue === v || undefined}
                onClick={() => switchVenue(v)}
              >{VENUES[v]?.shortLabel ?? v}</button>
            ))}
          </div>
        )}
      </div>
      <div className={styles.body}>
        {mode === 'price' ? (
          <>
            {isLoading && <div className={styles.empty}>loading…</div>}
            {error && <div className={styles.empty}>error — retry</div>}
            {!isLoading && !error && candles.length === 0 && (
              <div className={styles.empty}>
                No historical data for this strike on {VENUES[venue]?.shortLabel ?? venue}
              </div>
            )}
            {!isLoading && !error && candles.length > 0 && (
              <InstrumentChart candles={candles} markLine={markLine} overlays={overlays} />
            )}
          </>
        ) : (
          <>
            {attribution.unsupportedUnderlying && (
              <div className={styles.empty}>Attribution unavailable for {initial.underlying} (BTC / ETH only)</div>
            )}
            {!attribution.unsupportedUnderlying && attribution.isLoading && (
              <div className={styles.empty}>computing attribution…</div>
            )}
            {!attribution.unsupportedUnderlying && attribution.error && (
              <div className={styles.empty}>error — retry</div>
            )}
            {!attribution.unsupportedUnderlying && attribution.insufficientData && (
              <div className={styles.empty}>insufficient option / forward data overlap</div>
            )}
            {attribution.result && (
              <>
                <AttributionSummary
                  summary={attribution.result.summary}
                  priceCurrency={attribution.displayCurrency ?? 'USD'}
                />
                <InstrumentAttributionChart
                  result={attribution.result}
                  priceCurrency={attribution.displayCurrency ?? 'USD'}
                />
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
