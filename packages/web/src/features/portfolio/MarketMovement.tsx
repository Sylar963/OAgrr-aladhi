import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import type { PositionLeg } from '@oggregator/protocol';
import { fetchJson } from '@lib/http';
import { VENUES, VENUE_IDS } from '@lib/venue-meta';
import styles from './MarketMovement.module.css';

const iv = z.number().finite().positive().nullable();
const surfaceSchema = z.object({
  surface: z.array(z.object({ expiry: z.string(), dte: z.number(), atm: iv, delta25c: iv, delta25p: iv })),
});
type SurfaceRow = z.infer<typeof surfaceSchema>['surface'][number];
type Baseline = { atm: number; skew: number; capturedAt: number; receivedAt: number };

function measurement(row: SurfaceRow | undefined) {
  if (row?.atm == null || row.delta25c == null || row.delta25p == null || row.dte <= 0) return null;
  return { atm: row.atm, skew: row.delta25c - row.delta25p };
}

function points(value: number) {
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}`;
}

export function MovementTracker({ row, receivedAt, available }: {
  row: SurfaceRow | undefined; receivedAt: number; available: boolean;
}) {
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const current = available ? measurement(row) : null;
  const atmChange = current && baseline ? (current.atm - baseline.atm) * 100 : null;
  const skewChange = current && baseline ? (current.skew - baseline.skew) * 100 : null;
  const extent = Math.max(5, Math.ceil(Math.max(Math.abs(atmChange ?? 0), Math.abs(skewChange ?? 0))));
  const x = 210 + (skewChange ?? 0) / extent * 145;
  const y = 115 - (atmChange ?? 0) / extent * 80;

  return <>
    <div className={styles.readings}>
      <span>ATM IV <strong>{current ? `${(current.atm * 100).toFixed(2)}%` : 'Unavailable'}</strong></span>
      <span>25Δ risk reversal <strong>{current ? `${points(current.skew * 100)} vol pts` : 'Unavailable'}</strong></span>
      <button type="button" disabled={!current} onClick={() => {
        if (current) setBaseline({ ...current, capturedAt: Date.now(), receivedAt });
      }}>{baseline ? 'Reset baseline' : 'Set baseline'}</button>
    </div>
    <p className={styles.note}>25Δ risk reversal = call IV − put IV. Uses nearest listed strikes to ATM and ±25Δ; strike selection can change as markets move. Separate from the matrix’s skew-slope shock.</p>
    {!current && <p role="status">Current surface unavailable. Tracking resumes when both IV measurements return.</p>}
    {!baseline && <p className={styles.note}>Set a baseline to track movement during this visit. Changing market selection or leaving this view clears it.</p>}
    {baseline && <>
      <p className={styles.note}>Baseline captured {new Date(baseline.capturedAt).toISOString()} · surface received {new Date(baseline.receivedAt).toISOString()}</p>
      <p className={styles.note}>Baseline ATM {(baseline.atm * 100).toFixed(2)}% · risk reversal {points(baseline.skew * 100)} vol pts</p>
      {atmChange != null && skewChange != null && <>
        <div className={styles.changes} aria-live="polite">
          <span>ATM change <strong>{points(atmChange)} vol pts</strong></span>
          <span>Risk reversal change <strong>{points(skewChange)} vol pts</strong></span>
        </div>
        <svg className={styles.chart} viewBox="0 0 420 250" role="img" aria-label={`Movement since baseline: ATM ${points(atmChange)}, risk reversal ${points(skewChange)} volatility points`}>
          <path d="M65 35H355V195H65Z" fill="none" stroke="#303833" />
          <path d="M65 115H355M210 35V195" stroke="#59635e" strokeDasharray="4 4" />
          <text x="210" y="18" textAnchor="middle">ATM IV change (vol pts)</text>
          <text x="55" y="40" textAnchor="end">+{extent}</text>
          <text x="55" y="199" textAnchor="end">−{extent}</text>
          <text x="65" y="217" textAnchor="middle">−{extent}</text>
          <text x="355" y="217" textAnchor="middle">+{extent}</text>
          <text x="210" y="240" textAnchor="middle">25Δ risk reversal change (vol pts)</text>
          <circle cx="210" cy="115" r="4" fill="#89938e" />
          <line x1="210" y1="115" x2={x} y2={y} stroke="#f5b84b" />
          <circle cx={x} cy={y} r="6" fill="#f5b84b" />
          <text x={x} y={y - 12} textAnchor="middle" fill="#f5b84b">Now</text>
        </svg>
      </>}
    </>}
    {receivedAt > 0 && <p className={styles.note}>Last surface received {new Date(receivedAt).toISOString()} · refreshes every 15s. Receipt time is not an exchange quote timestamp.</p>}
  </>;
}

export default function MarketMovement({ positions }: { positions: PositionLeg[] }) {
  const underlyings = [...new Set(positions.map(position => position.underlying))].sort();
  const [chosenUnderlying, setUnderlying] = useState('');
  const underlying = underlyings.includes(chosenUnderlying) ? chosenUnderlying : underlyings[0] ?? '';
  const [chosenVenue, setVenue] = useState('');
  const venue = chosenVenue || positions.find(position => position.underlying === underlying)?.venueHint || 'deribit';
  const [expiry, setExpiry] = useState('');
  const query = useQuery({
    queryKey: ['portfolio-movement-surface', underlying, venue],
    queryFn: async () => surfaceSchema.parse(await fetchJson<unknown>(`/surface?underlying=${encodeURIComponent(underlying)}&venues=${encodeURIComponent(venue)}`)),
    enabled: Boolean(underlying),
    refetchInterval: 15_000,
    staleTime: 10_000,
  });
  const rows = query.data?.surface.filter(row => row.dte > 0) ?? [];
  const selectedExpiry = expiry || rows[0]?.expiry || '';
  if (!underlying) return null;

  return <section className={styles.wrap} aria-label="Market movement">
    <div className={styles.header}>
      <div><h3>Market movement</h3><p className={styles.note}>Track one venue and expiry against a fixed baseline · no P&amp;L projection</p></div>
      <div className={styles.controls}>
        <label>Underlying<select value={underlying} onChange={event => { setUnderlying(event.target.value); setExpiry(''); }}>
          {underlyings.map(value => <option key={value}>{value}</option>)}
        </select></label>
        <label>Venue<select value={venue} onChange={event => { setVenue(event.target.value); setExpiry(''); }}>
          {VENUE_IDS.map(value => <option key={value} value={value}>{VENUES[value]?.label ?? value}</option>)}
        </select></label>
        <label>Expiry<select value={selectedExpiry} onChange={event => setExpiry(event.target.value)}>
          {!selectedExpiry && <option value="">No expiries</option>}
          {expiry && !rows.some(row => row.expiry === expiry) && <option value={expiry}>{expiry} (unavailable)</option>}
          {rows.map(row => <option key={row.expiry}>{row.expiry}</option>)}
        </select></label>
      </div>
    </div>
    <MovementTracker key={`${underlying}:${venue}:${selectedExpiry}`} row={rows.find(row => row.expiry === selectedExpiry)} receivedAt={query.dataUpdatedAt} available={!query.isError && !query.isPending} />
  </section>;
}
