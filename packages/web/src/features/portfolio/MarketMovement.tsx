import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import type { PositionLeg } from '@oggregator/protocol';
import { fetchJson } from '@lib/http';
import { defineMessages, useT } from '@lib/i18n';
import { VENUES, VENUE_IDS } from '@lib/venue-meta';
import styles from './MarketMovement.module.css';

const iv = z.number().finite().positive().nullable();
const surfaceSchema = z.object({
  surface: z.array(z.object({ expiry: z.string(), dte: z.number(), atm: iv, delta25c: iv, delta25p: iv })),
});
type SurfaceRow = z.infer<typeof surfaceSchema>['surface'][number];
type Baseline = { atm: number; skew: number; capturedAt: number; receivedAt: number };

const messages = defineMessages(
  {
    unavailable: 'Unavailable',
    riskReversal25: '25Δ risk reversal',
    volPts: '{v} vol pts',
    resetBaseline: 'Reset baseline',
    setBaseline: 'Set baseline',
    rrNote:
      '25Δ risk reversal = call IV − put IV. Uses nearest listed strikes to ATM and ±25Δ; strike selection can change as markets move. Separate from the matrix’s skew-slope shock.',
    surfaceUnavailable:
      'Current surface unavailable. Tracking resumes when both IV measurements return.',
    baselineHint:
      'Set a baseline to track movement during this visit. Changing market selection or leaving this view clears it.',
    baselineCaptured: 'Baseline captured {captured} · surface received {received}',
    baselineValues: 'Baseline ATM {atm}% · risk reversal {rr} vol pts',
    atmChange: 'ATM change',
    rrChange: 'Risk reversal change',
    chartAria:
      'Movement since baseline: ATM {atm}, risk reversal {rr} volatility points',
    yAxis: 'ATM IV change (vol pts)',
    xAxis: '25Δ risk reversal change (vol pts)',
    now: 'Now',
    lastReceived:
      'Last surface received {at} · refreshes every 15s. Receipt time is not an exchange quote timestamp.',
    sectionAria: 'Market movement',
    title: 'Market movement',
    subtitle: 'Track one venue and expiry against a fixed baseline · no P&L projection',
    underlying: 'Underlying',
    venue: 'Venue',
    expiry: 'Expiry',
    noExpiries: 'No expiries',
    expiryUnavailable: '{expiry} (unavailable)',
  },
  {
    unavailable: 'No disponible',
    riskReversal25: 'Risk reversal 25Δ',
    volPts: '{v} pts de vol',
    resetBaseline: 'Reiniciar referencia',
    setBaseline: 'Fijar referencia',
    rrNote:
      'Risk reversal 25Δ = IV del call − IV del put. Usa los strikes listados más cercanos al ATM y ±25Δ; la selección de strikes puede cambiar con el mercado. Distinto del shock de pendiente de skew de la matriz.',
    surfaceUnavailable:
      'Superficie actual no disponible. El seguimiento se reanuda cuando vuelvan ambas medidas de IV.',
    baselineHint:
      'Fija una referencia para seguir el movimiento durante esta visita. Cambiar la selección de mercado o salir de esta vista la borra.',
    baselineCaptured: 'Referencia capturada {captured} · superficie recibida {received}',
    baselineValues: 'Referencia ATM {atm}% · risk reversal {rr} pts de vol',
    atmChange: 'Cambio ATM',
    rrChange: 'Cambio de risk reversal',
    chartAria:
      'Movimiento desde la referencia: ATM {atm}, risk reversal {rr} puntos de volatilidad',
    yAxis: 'Cambio de IV ATM (pts de vol)',
    xAxis: 'Cambio de risk reversal 25Δ (pts de vol)',
    now: 'Ahora',
    lastReceived:
      'Última superficie recibida {at} · se actualiza cada 15s. La hora de recepción no es la marca de tiempo de la cotización del exchange.',
    sectionAria: 'Movimiento de mercado',
    title: 'Movimiento de mercado',
    subtitle: 'Sigue un exchange y vencimiento contra una referencia fija · sin proyección de P&L',
    underlying: 'Subyacente',
    venue: 'Exchange',
    expiry: 'Vencimiento',
    noExpiries: 'Sin vencimientos',
    expiryUnavailable: '{expiry} (no disponible)',
  },
);

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
  const t = useT(messages);
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const current = available ? measurement(row) : null;
  const atmChange = current && baseline ? (current.atm - baseline.atm) * 100 : null;
  const skewChange = current && baseline ? (current.skew - baseline.skew) * 100 : null;
  const extent = Math.max(5, Math.ceil(Math.max(Math.abs(atmChange ?? 0), Math.abs(skewChange ?? 0))));
  const x = 210 + (skewChange ?? 0) / extent * 145;
  const y = 115 - (atmChange ?? 0) / extent * 80;

  return <>
    <div className={styles.readings}>
      <span>ATM IV <strong>{current ? `${(current.atm * 100).toFixed(2)}%` : t('unavailable')}</strong></span>
      <span>{t('riskReversal25')} <strong>{current ? t('volPts', { v: points(current.skew * 100) }) : t('unavailable')}</strong></span>
      <button type="button" disabled={!current} onClick={() => {
        if (current) setBaseline({ ...current, capturedAt: Date.now(), receivedAt });
      }}>{baseline ? t('resetBaseline') : t('setBaseline')}</button>
    </div>
    <p className={styles.note}>{t('rrNote')}</p>
    {!current && <p role="status">{t('surfaceUnavailable')}</p>}
    {!baseline && <p className={styles.note}>{t('baselineHint')}</p>}
    {baseline && <>
      <p className={styles.note}>{t('baselineCaptured', { captured: new Date(baseline.capturedAt).toISOString(), received: new Date(baseline.receivedAt).toISOString() })}</p>
      <p className={styles.note}>{t('baselineValues', { atm: (baseline.atm * 100).toFixed(2), rr: points(baseline.skew * 100) })}</p>
      {atmChange != null && skewChange != null && <>
        <div className={styles.changes} aria-live="polite">
          <span>{t('atmChange')} <strong>{t('volPts', { v: points(atmChange) })}</strong></span>
          <span>{t('rrChange')} <strong>{t('volPts', { v: points(skewChange) })}</strong></span>
        </div>
        <svg className={styles.chart} viewBox="0 0 420 250" role="img" aria-label={t('chartAria', { atm: points(atmChange), rr: points(skewChange) })}>
          <path d="M65 35H355V195H65Z" fill="none" stroke="#303833" />
          <path d="M65 115H355M210 35V195" stroke="#59635e" strokeDasharray="4 4" />
          <text x="210" y="18" textAnchor="middle">{t('yAxis')}</text>
          <text x="55" y="40" textAnchor="end">+{extent}</text>
          <text x="55" y="199" textAnchor="end">−{extent}</text>
          <text x="65" y="217" textAnchor="middle">−{extent}</text>
          <text x="355" y="217" textAnchor="middle">+{extent}</text>
          <text x="210" y="240" textAnchor="middle">{t('xAxis')}</text>
          <circle cx="210" cy="115" r="4" fill="#89938e" />
          <line x1="210" y1="115" x2={x} y2={y} stroke="#f5b84b" />
          <circle cx={x} cy={y} r="6" fill="#f5b84b" />
          <text x={x} y={y - 12} textAnchor="middle" fill="#f5b84b">{t('now')}</text>
        </svg>
      </>}
    </>}
    {receivedAt > 0 && <p className={styles.note}>{t('lastReceived', { at: new Date(receivedAt).toISOString() })}</p>}
  </>;
}

export default function MarketMovement({ positions }: { positions: PositionLeg[] }) {
  const t = useT(messages);
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

  return <section className={styles.wrap} aria-label={t('sectionAria')}>
    <div className={styles.header}>
      <div><h3>{t('title')}</h3><p className={styles.note}>{t('subtitle')}</p></div>
      <div className={styles.controls}>
        <label>{t('underlying')}<select value={underlying} onChange={event => { setUnderlying(event.target.value); setExpiry(''); }}>
          {underlyings.map(value => <option key={value}>{value}</option>)}
        </select></label>
        <label>{t('venue')}<select value={venue} onChange={event => { setVenue(event.target.value); setExpiry(''); }}>
          {VENUE_IDS.map(value => <option key={value} value={value}>{VENUES[value]?.label ?? value}</option>)}
        </select></label>
        <label>{t('expiry')}<select value={selectedExpiry} onChange={event => setExpiry(event.target.value)}>
          {!selectedExpiry && <option value="">{t('noExpiries')}</option>}
          {expiry && !rows.some(row => row.expiry === expiry) && <option value={expiry}>{t('expiryUnavailable', { expiry })}</option>}
          {rows.map(row => <option key={row.expiry}>{row.expiry}</option>)}
        </select></label>
      </div>
    </div>
    <MovementTracker key={`${underlying}:${venue}:${selectedExpiry}`} row={rows.find(row => row.expiry === selectedExpiry)} receivedAt={query.dataUpdatedAt} available={!query.isError && !query.isPending} />
  </section>;
}
