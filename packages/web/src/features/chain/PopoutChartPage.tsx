import { useEffect, useMemo, useState } from 'react';
import { VENUE_IDS, type InstrumentCandleInterval, type InstrumentCandleRange, type VenueId } from '@oggregator/protocol';
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
import styles from './PopoutChartPage.module.css';

const INTERVALS: InstrumentCandleInterval[] = ['1m', '5m', '15m', '1h', '4h', '1d'];
const RANGES: InstrumentCandleRange[] = ['1d', '7d', '30d', 'max'];

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
    document.title = `${initial.symbol} · ${VENUES[initial.venue]?.shortLabel ?? initial.venue}`;
  }, [initial.symbol, initial.venue]);

  // Bootstrap chain data so useLiveMidFromChain has something to read.
  useChainQuery(initial.underlying, initial.expiry, [initial.venue]);
  useChainWs({
    underlying: initial.underlying,
    expiry: initial.expiry,
    venues: [initial.venue],
  });

  const liveMid = useLiveMidFromChain(
    initial.underlying, initial.expiry, initial.strike, initial.type, initial.venue,
  );
  const { candles, markLine, isLoading, error, priceCurrency } = useInstrumentCandles({
    venue: initial.venue,
    symbol: initial.symbol,
    interval,
    range,
    liveMid,
  });
  const attribution = useInstrumentAttribution({
    venue: initial.venue,
    symbol: initial.symbol,
    interval,
    range,
    underlying: initial.underlying,
    strike: initial.strike,
    right: initial.type,
    expiry: initial.expiry,
    enabled: mode === 'attribution',
  });
  const countdown = useCandleCountdown(interval);

  return (
    <div className={styles.root}>
      <div className={styles.titlebar}>
        <span className={styles.title}>
          {initial.symbol}
          <span className={styles.venueLabel}> · {VENUES[initial.venue]?.shortLabel ?? initial.venue}</span>
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
      </div>
      <div className={styles.body}>
        {mode === 'price' ? (
          <>
            {isLoading && <div className={styles.empty}>loading…</div>}
            {error && <div className={styles.empty}>error — retry</div>}
            {!isLoading && !error && candles.length === 0 && (
              <div className={styles.empty}>
                No historical data for this strike on {VENUES[initial.venue]?.shortLabel ?? initial.venue}
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
