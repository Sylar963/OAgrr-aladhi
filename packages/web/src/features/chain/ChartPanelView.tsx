import { useQueryClient } from '@tanstack/react-query';
import type { InstrumentCandleInterval, InstrumentCandleRange, VenueId } from '@oggregator/protocol';
import type { EnrichedChainResponse } from '@shared/enriched';
import { VENUES } from '@lib/venue-meta';
import type { ChartPanel } from './chart-panels-store.js';
import { useInstrumentCandles, useLiveMidFromChain } from './use-instrument-candles.js';
import { useCandleCountdown } from './candle-countdown.js';
import { useInstrumentAttribution } from './use-instrument-attribution.js';
import InstrumentChart from './InstrumentChart.js';
import InstrumentAttributionChart from './InstrumentAttributionChart.js';
import { AttributionSummary } from './AttributionSummary.js';
import { isChartSupportedVenue, NotSupportedVenueError, toVenueSymbol } from './instrument-symbol.js';

export const INTERVALS: readonly InstrumentCandleInterval[] = ['1m', '5m', '15m', '1h', '4h', '1d'];
export const RANGES: readonly InstrumentCandleRange[] = ['1d', '7d', '30d', 'max'];

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

export function ChartPanelView({ data, styles, onPatch, onSwitchVenue, onClose }: ChartPanelViewProps) {
  const strikeVenues = useStrikeVenues(data.underlying, data.expiry, data.strike, data.type);

  const liveMid = useLiveMidFromChain(
    data.underlying, data.expiry, data.strike, data.type, data.venue,
  );
  const { candles, markLine, isLoading, error, priceCurrency } = useInstrumentCandles({
    venue: data.venue,
    symbol: data.symbol,
    interval: data.interval,
    range: data.range,
    liveMid,
  });
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
              onClick={() => onPatch({ interval: i })}
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
              onClick={() => onPatch({ range: r })}
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
            {isLoading && <div className={styles.empty}>loading…</div>}
            {error && <div className={styles.empty}>error — retry</div>}
            {!isLoading && !error && candles.length === 0 && (
              <div className={styles.empty}>
                No historical data for this strike on {VENUES[data.venue]?.shortLabel ?? data.venue}
              </div>
            )}
            {!isLoading && !error && candles.length > 0 && (
              <InstrumentChart candles={candles} markLine={markLine} overlays={data.overlays} />
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
