import type { PositionLeg } from '@features/portfolio';
import { fmtNum, fmtPct, fmtUsdPrice } from '@lib/format';
import type { LiquidityResponse } from '@oggregator/protocol';
import { type FormEvent, useId, useMemo, useState } from 'react';
import { useLiquidity } from './hooks/useLiquidity';
import {
  LIQUIDITY_DEFAULT_INSTRUMENTS,
  type LiquidityRequest,
  type LiquiditySide,
  thalexOptionSymbol,
} from './liquidity';
import styles from './LiquidityCard.module.css';

const LADDER_ROWS = 8;

/** Read-only estimate from Thalex's live book. It never places anything. */
export default function LiquidityCard({ positions }: { positions: PositionLeg[] }) {
  const listId = useId();
  const [instrument, setInstrument] = useState('');
  const [side, setSide] = useState<LiquiditySide>('buy');
  const [size, setSize] = useState('1');
  const [request, setRequest] = useState<LiquidityRequest | null>(null);
  const query = useLiquidity(request);

  const suggestions = useMemo(
    () => [
      ...new Set([
        ...LIQUIDITY_DEFAULT_INSTRUMENTS,
        ...positions.filter((leg) => leg.expiry && leg.underlying).map(thalexOptionSymbol),
      ]),
    ],
    [positions],
  );

  const parsedSize = Number(size);
  const canSubmit = instrument.trim() !== '' && Number.isFinite(parsedSize) && parsedSize > 0;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setRequest({ instrument: instrument.trim().toUpperCase(), side, size: parsedSize });
  }

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <span>Liquidity estimate (Thalex book)</span>
        {query.data && <span className={styles.state}>{stateLabel(query.data)}</span>}
      </div>
      <form className={styles.form} onSubmit={submit}>
        <label className={styles.field}>
          <span>Instrument</span>
          <input
            list={listId}
            value={instrument}
            placeholder="BTC-PERPETUAL"
            onChange={(e) => setInstrument(e.target.value)}
            spellCheck={false}
          />
          <datalist id={listId}>
            {suggestions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </label>
        <label className={styles.field}>
          <span>Side</span>
          <select value={side} onChange={(e) => setSide(e.target.value as LiquiditySide)}>
            <option value="buy">Taking asks</option>
            <option value="sell">Hitting bids</option>
          </select>
        </label>
        <label className={styles.field}>
          <span>Size (coin)</span>
          <input
            type="number"
            min="0"
            step="any"
            value={size}
            onChange={(e) => setSize(e.target.value)}
          />
        </label>
        <button type="submit" className={styles.submit} disabled={!canSubmit}>
          Estimate
        </button>
      </form>

      {query.isError && <div className={styles.empty}>{errorText(query.error)}</div>}
      {query.isLoading && <div className={styles.empty}>Loading book…</div>}
      {query.data && <Estimate data={query.data} />}
    </div>
  );
}

function Estimate({ data }: { data: LiquidityResponse }) {
  const { fill } = data;
  return (
    <>
      <div className={styles.metricGrid}>
        <Metric label="Filled" value={`${fmtNum(fill.filled, 4)} / ${fmtNum(fill.requested, 4)}`} warn={!fill.fullyFilled} />
        <Metric label="VWAP" value={fmtUsdPrice(fill.vwap)} />
        <Metric label="Worst level" value={fmtUsdPrice(fill.worstPrice)} />
        <Metric label="vs mark" value={fmtPct(fill.slippageVsMarkPct, 3)} />
        <Metric label="vs touch" value={fmtPct(fill.slippageVsTouchPct, 3)} />
        <Metric label="Spread" value={fmtPct(data.spreadPct, 3)} />
      </div>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Within</th>
            <th className={styles.rightAlign}>Bid size</th>
            <th className={styles.rightAlign}>Ask size</th>
          </tr>
        </thead>
        <tbody>
          {data.depth.map((band) => (
            <tr key={band.pct}>
              <td>±{band.pct}% of mark</td>
              <td className={styles.rightAlign}>{fmtNum(band.bidAmount, 4)}</td>
              <td className={styles.rightAlign}>{fmtNum(band.askAmount, 4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table className={styles.table} aria-label="Order book ladder">
        <thead>
          <tr>
            <th className={styles.rightAlign}>Bid size</th>
            <th className={styles.rightAlign}>Bid</th>
            <th className={styles.rightAlign}>Ask</th>
            <th className={styles.rightAlign}>Ask size</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: Math.min(LADDER_ROWS, Math.max(data.bids.length, data.asks.length)) }, (_, i) => (
            <tr key={i}>
              <td className={styles.rightAlign}>{fmtNum(data.bids[i]?.amount, 4)}</td>
              <td className={`${styles.rightAlign} ${styles.bid}`}>{fmtUsdPrice(data.bids[i]?.price)}</td>
              <td className={`${styles.rightAlign} ${styles.ask}`}>{fmtUsdPrice(data.asks[i]?.price)}</td>
              <td className={styles.rightAlign}>{fmtNum(data.asks[i]?.amount, 4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function Metric({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={styles.metricCard}>
      <div className={styles.metricLabel}>{label}</div>
      <div className={`${styles.metricValue} ${warn ? styles.warn : ''}`}>{value}</div>
    </div>
  );
}

function stateLabel(data: LiquidityResponse): string {
  if (data.state !== 'synced') return 'resyncing';
  if (data.crossed) return 'crossed book';
  return `live · ${Math.round(data.bookAgeMs)}ms`;
}

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/404/.test(message)) return 'Thalex has no book for that instrument.';
  if (/429/.test(message)) return 'Too many books open right now; try again shortly.';
  if (/400/.test(message)) return 'Use a Thalex instrument name, e.g. BTC-PERPETUAL or BTC-23OCT26-84000-C.';
  return 'Book unavailable right now.';
}
