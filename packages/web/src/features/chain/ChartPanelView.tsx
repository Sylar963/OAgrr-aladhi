import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { InstrumentCandlesResponse, VenueId } from '@oggregator/protocol';
import type { EnrichedChainResponse } from '@shared/enriched';
import { VENUES } from '@lib/venue-meta';
import type { ChartPanel } from './chart-panels-store.js';
import { instrumentCandlesKey, useInstrumentCandles, useLiveMidFromChain } from './use-instrument-candles.js';
import { useCandleCountdown } from './candle-countdown.js';
import { useInstrumentAttribution } from './use-instrument-attribution.js';
import InstrumentChart from './InstrumentChart.js';
import { useInstrumentEntries } from './use-instrument-entries.js';
import InstrumentAttributionChart from './InstrumentAttributionChart.js';
import { AttributionSummary } from './AttributionSummary.js';
import { CHART_SUPPORTED_VENUES, NotSupportedVenueError, toVenueSymbol } from './instrument-symbol.js';
import {
  fallbackTimeframes,
  INTERVALS,
  isCandleStateUnavailable,
  RANGES,
  type Timeframe,
} from './timeframe-fallback.js';

export { INTERVALS, RANGES };

export type ChartPanelData = Omit<ChartPanel, 'id'>;

export type ChartPanelStyles = Readonly<Record<string, string>>;

export interface ChartPanelViewProps {
  data: ChartPanelData;
  styles: ChartPanelStyles;
  onPatch: (patch: Partial<ChartPanelData>) => void;
  onSwitchVenue: (venue: VenueId, symbol: string) => void;
  onClose?: () => void;
}

export function useStrikeVenues(
  underlying: string,
  expiry: string,
  strike: number,
  type: 'call' | 'put',
): VenueId[] {
  const qc = useQueryClient();
  const subscribe = useCallback((cb: () => void) => qc.getQueryCache().subscribe(cb), [qc]);
  // Several chain entries can be cached for one expiry (e.g. the popout's
  // all-venue REST query next to its single-venue WS feed), so union them
  // rather than trusting whichever entry happens to come first.
  const getSnapshot = useCallback(() => {
    const quoted = new Set<string>();
    for (const [, data] of qc.getQueriesData<EnrichedChainResponse>({ queryKey: ['chain', underlying, expiry] })) {
      const row = data?.strikes.find((s) => s.strike === strike);
      if (!row) continue;
      const side = type === 'call' ? row.call : row.put;
      for (const v of Object.keys(side.venues)) quoted.add(v);
    }
    return CHART_SUPPORTED_VENUES.filter((v) => quoted.has(v)).join(',');
  }, [qc, underlying, expiry, strike, type]);
  const joined = useSyncExternalStore(subscribe, getSnapshot);
  return useMemo(() => (joined ? (joined.split(',') as VenueId[]) : []), [joined]);
}

export function ChartPanelView({ data, styles, onPatch, onSwitchVenue, onClose }: ChartPanelViewProps) {
  const qc = useQueryClient();
  const strikeVenues = useStrikeVenues(data.underlying, data.expiry, data.strike, data.type);
  const [anchor, setAnchor] = useState<Timeframe>({ interval: data.interval, range: data.range });

  const liveMid = useLiveMidFromChain(
    data.underlying, data.expiry, data.strike, data.type, data.venue,
  );
  const candleQuery = useInstrumentCandles({
    venue: data.venue,
    symbol: data.symbol,
    interval: data.interval,
    range: data.range,
    liveMid,
  });
  const { candles, markLine, isLoading, error, priceCurrency } = candleQuery;

  const unavailable = data.chartMode === 'price' && isCandleStateUnavailable(candleQuery);
  const nextTimeframe = unavailable
    ? fallbackTimeframes(anchor).find(
        (tf) =>
          !isCandleStateUnavailable(
            qc.getQueryState<InstrumentCandlesResponse>(
              instrumentCandlesKey(data.venue, data.symbol, tf.interval, tf.range),
            ),
          ),
      )
    : undefined;
  const fallingBack = nextTimeframe != null;

  const applyPatch = useEffectEvent((patch: Partial<ChartPanelData>) => onPatch(patch));

  useEffect(() => {
    if (nextTimeframe) applyPatch(nextTimeframe);
  }, [nextTimeframe?.interval, nextTimeframe?.range]);

  // A fallback is specific to one instrument: on a venue switch, retry the
  // timeframe the user actually picked before falling back again.
  const instrumentKey = `${data.venue}|${data.symbol}`;
  const prevInstrumentKey = useRef(instrumentKey);
  useEffect(() => {
    if (prevInstrumentKey.current === instrumentKey) return;
    prevInstrumentKey.current = instrumentKey;
    applyPatch(anchor);
  }, [instrumentKey]);

  function selectTimeframe(patch: Partial<Timeframe>): void {
    setAnchor({ interval: data.interval, range: data.range, ...patch });
    onPatch(patch);
  }
  const attribution = useInstrumentAttribution({
    venue: data.venue,
    symbol: data.symbol,
    interval: data.interval,
    range: data.range,
    underlying: data.underlying,
    strike: data.strike,
    right: data.type,
    expiry: data.expiry,
    enabled: data.chartMode === 'attribution',
  });
  const countdown = useCandleCountdown(data.interval);
  const { entries, venueLeg } = useInstrumentEntries({
    venue: data.venue,
    underlying: data.underlying,
    expiry: data.expiry,
    strike: data.strike,
    type: data.type,
  });
  const liveSpotUsd =
    liveMid?.usd != null && liveMid.raw != null && liveMid.raw > 0 ? liveMid.usd / liveMid.raw : null;

  function switchVenue(nextVenue: VenueId): void {
    if (nextVenue === data.venue) return;
    try {
      const nextSymbol = toVenueSymbol({
        venue: nextVenue,
        underlying: data.underlying,
        expiry: data.expiry,
        strike: data.strike,
        type: data.type,
      });
      onSwitchVenue(nextVenue, nextSymbol);
    } catch (err) {
      if (err instanceof NotSupportedVenueError) return;
      throw err;
    }
  }

  return (
    <>
      <div className={styles.titlebar}>
        <span className={styles.title}>
          {data.symbol}
          <span className={styles.venueLabel}> · {VENUES[data.venue]?.shortLabel ?? data.venue}</span>
          {priceCurrency && (
            <span className={styles.venueLabel}> · {priceCurrency}</span>
          )}
        </span>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close">✕</button>
        )}
      </div>
      <div className={styles.toolbar}>
        <div className={styles.modes}>
          <button
            type="button"
            data-active={data.chartMode === 'price' || undefined}
            onClick={() => onPatch({ chartMode: 'price' })}
          >Price</button>
          <button
            type="button"
            data-active={data.chartMode === 'attribution' || undefined}
            onClick={() => onPatch({ chartMode: 'attribution' })}
          >Attribution</button>
        </div>
        <div className={styles.intervals}>
          {INTERVALS.map((i) => (
            <button
              key={i}
              type="button"
              data-active={data.interval === i || undefined}
              onClick={() => selectTimeframe({ interval: i })}
            >{i}</button>
          ))}
          <span className={styles.countdown} title={`Next ${data.interval} bar closes in ${countdown}`}>
            {countdown}
          </span>
        </div>
        <div className={styles.ranges}>
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              data-active={data.range === r || undefined}
              onClick={() => selectTimeframe({ range: r })}
            >{r}</button>
          ))}
        </div>
        <div className={styles.overlays}>
          <button
            type="button"
            data-active={data.overlays.mark || undefined}
            onClick={() => onPatch({ overlays: { ...data.overlays, mark: !data.overlays.mark } })}
          >Mark</button>
          <button
            type="button"
            data-active={data.overlays.ma9 || undefined}
            onClick={() => onPatch({ overlays: { ...data.overlays, ma9: !data.overlays.ma9 } })}
          >MA9</button>
          <button
            type="button"
            data-active={data.overlays.ma20 || undefined}
            onClick={() => onPatch({ overlays: { ...data.overlays, ma20: !data.overlays.ma20 } })}
          >MA20</button>
          <button
            type="button"
            data-active={data.overlays.entries !== false || undefined}
            title={`My fills on ${VENUES[data.venue]?.shortLabel ?? data.venue} (paper + live)`}
            onClick={() => onPatch({ overlays: { ...data.overlays, entries: data.overlays.entries === false } })}
          >Entries{entries.length > 0 ? ` ${entries.length}` : ''}</button>
        </div>
        {strikeVenues.length > 0 && (
          <div className={styles.venueDots}>
            {strikeVenues.map((v) => (
              <button
                key={v}
                type="button"
                data-active={data.venue === v || undefined}
                onClick={() => switchVenue(v)}
              >{VENUES[v]?.shortLabel ?? v}</button>
            ))}
          </div>
        )}
      </div>
      <div className={styles.body}>
        {data.chartMode === 'price' ? (
          <>
            {(isLoading || fallingBack) && <div className={styles.empty}>loading…</div>}
            {error && !fallingBack && <div className={styles.empty}>error — retry</div>}
            {!isLoading && !error && !fallingBack && candles.length === 0 && (
              <div className={styles.empty}>
                No historical data for this strike on {VENUES[data.venue]?.shortLabel ?? data.venue}
              </div>
            )}
            {!isLoading && !error && candles.length > 0 && (
              <InstrumentChart
                candles={candles}
                markLine={markLine}
                overlays={data.overlays}
                entries={entries}
                priceCurrency={priceCurrency}
                fallbackSpotUsd={liveSpotUsd}
                venueLeg={venueLeg}
              />
            )}
          </>
        ) : (
          <>
            {attribution.unsupportedUnderlying && (
              <div className={styles.empty}>Attribution unavailable for {data.underlying} (BTC / ETH only)</div>
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
    </>
  );
}
