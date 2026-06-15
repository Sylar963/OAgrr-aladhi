import { useState } from 'react';
import InstrumentChart from '@features/chain/InstrumentChart';
import { Spinner, EmptyState } from '@components/ui';
import type { InstrumentCandleInterval, InstrumentCandleRange } from '@oggregator/protocol';
import { useTradfiCandles } from './use-tradfi-candles';
import styles from './TradfiPriceChart.module.css';

const INTERVALS: InstrumentCandleInterval[] = ['5m', '15m', '1h', '1d'];
const RANGES: InstrumentCandleRange[] = ['1d', '7d', '30d', 'max'];

interface TradfiPriceChartProps {
  underlying: string;
  expiry: string;
  strikes: number[];
  atmStrike: number | null;
}

export default function TradfiPriceChart({
  underlying,
  expiry,
  strikes,
  atmStrike,
}: TradfiPriceChartProps) {
  const [strike, setStrike] = useState<number | null>(atmStrike ?? strikes[0] ?? null);
  const [right, setRight] = useState<'call' | 'put'>('call');
  const [interval, setInterval] = useState<InstrumentCandleInterval>('5m');
  const [range, setRange] = useState<InstrumentCandleRange>('7d');

  const { data, isLoading, error } = useTradfiCandles({
    underlying,
    expiry,
    strike,
    right,
    interval,
    range,
  });

  return (
    <div className={styles.panel}>
      <div className={styles.controls}>
        <select
          value={strike ?? ''}
          onChange={(e) => setStrike(Number(e.target.value))}
          aria-label="Strike"
        >
          {strikes.map((k) => (
            <option key={k} value={k}>
              {k.toLocaleString()}
            </option>
          ))}
        </select>

        <div className={styles.toggle}>
          {(['call', 'put'] as const).map((r) => (
            <button
              key={r}
              type="button"
              data-active={right === r}
              onClick={() => setRight(r)}
            >
              {r.toUpperCase()}
            </button>
          ))}
        </div>

        <div className={styles.toggle}>
          {INTERVALS.map((i) => (
            <button
              key={i}
              type="button"
              data-active={interval === i}
              onClick={() => setInterval(i)}
            >
              {i}
            </button>
          ))}
        </div>

        <div className={styles.toggle}>
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              data-active={range === r}
              onClick={() => setRange(r)}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.chart}>
        {isLoading && !data && <Spinner size="lg" label="Loading candles…" />}
        {error && (
          <EmptyState
            icon="⚠"
            title="Couldn't load candles"
            detail="The candle feed is unavailable or this strike isn't recognized."
          />
        )}
        {data && data.candles.length === 0 && (
          <EmptyState
            icon="∅"
            title="No candle history"
            detail="This strike has no bars for the selected range."
          />
        )}
        {data && data.candles.length > 0 && (
          <InstrumentChart
            candles={data.candles}
            markLine={data.markLine}
            overlays={{ mark: false, ma9: true, ma20: true }}
          />
        )}
      </div>
    </div>
  );
}
