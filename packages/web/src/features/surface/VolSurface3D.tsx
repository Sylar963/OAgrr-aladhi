import { useMemo, useState } from 'react';

import type { IvSurfaceResponse } from '@shared/enriched';

import { Spinner, DropdownPicker, InfoTip } from '@components/ui';
import { useUnderlyings } from '@features/chain';
import { defineMessages, useT } from '@lib/i18n';
import { getTokenLogo } from '@lib/token-meta';
import { VENUE_IDS, VENUE_LIST } from '@lib/venue-meta';
import { formatExpiry } from '@lib/format';
import { surfaceMessages } from './i18n';
import { Plot, PLOTLY_3D_CONFIG, SCENE_DEFAULTS } from './plotly';
import { deltaTickLabel } from './smile-utils';
import { useSurface } from './queries';
import { type SurfaceMarket, TRADFI_SURFACE_VENUES, useSurfaceUnderlying } from './surface-market';
import styles from './VolSurface3D.module.css';

type TenorMode = 'listed' | 'cmm';

// Drop expiries thinner than this — sparse rows render as spikes/holes.
// Only applied to the listed/raw mode; smoothed and CMM rows are dense by
// construction.
const MIN_NON_NULL_PER_ROW = 3;

const messages = defineMessages(
  {
    title: '3D IV Surface',
    noData: 'No surface data',
    average: 'Average',
    listed: 'Listed',
    cmm: 'Constant Maturity',
    hover: 'Delta: %{x}<br>Expiry: %{text}<br>IV: %{z:.1f}%<extra></extra>',
    tipIntro:
      'Implied vol across strike (X = delta), time (Y = tenor), and magnitude (Z = IV %, also encoded by color).',
    tipXHead: 'X — delta',
    tipX: ': 5Δp (deep OTM put) → ATM (0.5) → 5Δc (deep OTM call). Wings above ATM = skew / tail-risk premium.',
    tipYHead: 'Y — tenor',
    tipY: ': days to expiry, near → far. Upward slope = contango; inversion = near-term stress.',
    tipZHead: 'Z & color',
    tipZ: ': IV in %. Blue = low, white = mid, orange = high. Where listed strikes are sparse, the surface is filled by an SVI fit (Gatheral 2004) per expiry, with linear interpolation as fallback.',
    tipVenueHead: 'Venue picker',
    tipVenue: ': single-venue vs cross-venue Average. Average smooths venue quirks; single venue exposes microstructure.',
    tipTenorHead: 'Tenor mode',
    tipTenor: ': Listed = each row is a real expiry. Constant Maturity = canonical 7/14/30/60/90/180/365d tenors, interpolated in total variance between bracketing listed expiries.',
  },
  {
    title: 'Superficie de IV 3D',
    noData: 'Sin datos de superficie',
    average: 'Promedio',
    listed: 'Listados',
    cmm: 'Vencimiento constante',
    hover: 'Delta: %{x}<br>Vencimiento: %{text}<br>IV: %{z:.1f}%<extra></extra>',
    tipIntro:
      'Vol implícita según strike (X = delta), tiempo (Y = plazo) y magnitud (Z = IV %, también codificada por color).',
    tipXHead: 'X — delta',
    tipX: ': 5Δp (put muy OTM) → ATM (0.5) → 5Δc (call muy OTM). Alas por encima del ATM = skew / prima por riesgo de cola.',
    tipYHead: 'Y — plazo',
    tipY: ': días al vencimiento, de cerca → lejos. Pendiente positiva = contango; inversión = estrés de corto plazo.',
    tipZHead: 'Z y color',
    tipZ: ': IV en %. Azul = baja, blanco = media, naranja = alta. Donde los strikes listados son escasos, la superficie se completa con un ajuste SVI (Gatheral 2004) por vencimiento, con interpolación lineal como respaldo.',
    tipVenueHead: 'Selector de exchange',
    tipVenue: ': un solo exchange vs promedio entre exchanges. El promedio suaviza particularidades de cada exchange; uno solo expone la microestructura.',
    tipTenorHead: 'Modo de plazo',
    tipTenor: ': Listados = cada fila es un vencimiento real. Vencimiento constante = plazos canónicos de 7/14/30/60/90/180/365d, interpolados en varianza total entre los vencimientos listados adyacentes.',
  },
);

function SurfaceTipBody() {
  const t = useT(messages);
  return (
    <>
      <div>{t('tipIntro')}</div>
      <ul style={{ margin: '6px 0 0', paddingLeft: 14 }}>
        <li>
          <strong>{t('tipXHead')}</strong>
          {t('tipX')}
        </li>
        <li>
          <strong>{t('tipYHead')}</strong>
          {t('tipY')}
        </li>
        <li>
          <strong>{t('tipZHead')}</strong>
          {t('tipZ')}
        </li>
        <li>
          <strong>{t('tipVenueHead')}</strong>
          {t('tipVenue')}
        </li>
        <li>
          <strong>{t('tipTenorHead')}</strong>
          {t('tipTenor')}
        </li>
      </ul>
    </>
  );
}

interface SurfaceGrid {
  x: number[];
  y: number[];
  z: (number | null)[][];
  yLabels: string[];
  text: string[][];
}

function buildListedGrid(data: IvSurfaceResponse): SurfaceGrid | null {
  const useSmoothed = !!data.surfaceFineSmoothed?.length;
  const x = useSmoothed
    ? data.surfaceFineDeltasDense ?? data.surfaceFineDeltas
    : data.surfaceFineDeltas;
  if (!x || x.length === 0) return null;

  const source = useSmoothed ? data.surfaceFineSmoothed : data.surfaceFine;
  const sorted = source
    .filter((r) => r.dte > 0)
    .slice()
    .sort((a, b) => a.dte - b.dte);

  const rawByDte = new Map<number, (number | null)[]>();
  for (const r of data.surfaceFine) rawByDte.set(r.dte, r.ivs);

  // Y is the row's index, not its DTE. A linear-DTE axis collapsed weeklies
  // on top of each other in the 3D perspective; sqrt(T) helped but the front
  // tenors still overlapped at the camera vanishing point. Index spacing
  // guarantees every tenor gets equal visual separation. Temporal context is
  // preserved by the date labels themselves and the (Nd) hover suffix.
  const y: number[] = [];
  const yLabels: string[] = [];
  const z: (number | null)[][] = [];
  const text: string[][] = [];

  for (const row of sorted) {
    const rawRow = rawByDte.get(row.dte);
    const rawNonNull = rawRow ? rawRow.filter((v) => v != null).length : 0;
    if (rawNonNull < MIN_NON_NULL_PER_ROW) continue;

    const ivPct = row.ivs.map((v) => (v != null ? v * 100 : null));

    const label = formatExpiry(row.expiry);
    y.push(y.length);
    yLabels.push(label);
    z.push(ivPct);
    text.push(x.map(() => `${label} (${row.dte}d)`));
  }

  if (z.length === 0) return null;
  return { x, y, z, yLabels, text };
}

function buildCmmGrid(data: IvSurfaceResponse): SurfaceGrid | null {
  const x = data.surfaceFineDeltasDense ?? data.surfaceFineDeltas;
  if (!x || x.length === 0) return null;
  const rows = data.surfaceFineCmm ?? [];
  if (rows.length === 0) return null;

  const sorted = rows.slice().sort((a, b) => a.tenorDays - b.tenorDays);

  const y: number[] = [];
  const yLabels: string[] = [];
  const z: (number | null)[][] = [];
  const text: string[][] = [];

  for (const row of sorted) {
    const ivPct = row.ivs.map((v) => (v != null ? v * 100 : null));
    const label = `${row.tenorDays}d`;
    y.push(y.length);
    yLabels.push(label);
    z.push(ivPct);
    text.push(x.map(() => `${label} CMM`));
  }

  if (z.length === 0) return null;
  return { x, y, z, yLabels, text };
}

interface Props {
  defaultUnderlying?: string;
  market?: SurfaceMarket;
}

export default function VolSurface3D({ defaultUnderlying = 'BTC', market = 'crypto' }: Props) {
  const t = useT(messages);
  const ts = useT(surfaceMessages);
  const tradfi = market === 'tradfi';
  const { underlying: localUnderlying, setUnderlying: setLocalUnderlying } =
    useSurfaceUnderlying(market, defaultUnderlying);
  const [selectedVenue, setSelectedVenue] = useState('average');
  const [tenorMode, setTenorMode] = useState<TenorMode>('listed');

  const { data: underlyingsData } = useUnderlyings();
  const underlyings = underlyingsData?.underlyings ?? [];

  const venues = tradfi
    ? TRADFI_SURFACE_VENUES
    : selectedVenue === 'average'
      ? VENUE_IDS
      : [selectedVenue];
  const { data, isLoading } = useSurface(localUnderlying, venues, market);

  const grid = useMemo(() => {
    if (!data) return null;
    return tenorMode === 'cmm' ? buildCmmGrid(data) : buildListedGrid(data);
  }, [data, tenorMode]);

  const plotData = useMemo<Plotly.Data[] | null>(() => {
    if (!grid) return null;
    return [
      {
        type: 'surface' as const,
        x: grid.x,
        y: grid.y,
        z: grid.z,
        // Plotly's typings declare text as string | string[]; the runtime accepts
        // the 2-D form for surface traces and that's required for hover labels
        // to map to the right (delta, expiry) cell.
        text: grid.text as unknown as string[],
        colorscale: [
          [0, '#1e40af'],
          [0.35, '#60a5fa'],
          [0.5, '#f5f5f5'],
          [0.7, '#fb923c'],
          [1, '#ea580c'],
        ],
        showscale: true,
        colorbar: {
          title: { text: 'IV %', font: { color: '#888', size: 11 } },
          tickfont: { color: '#888', size: 10, family: "'IBM Plex Mono', monospace" },
          bgcolor: 'rgba(0,0,0,0)',
          thickness: 12,
          len: 0.6,
        },
        hovertemplate: t('hover'),
        contours: {
          z: { show: true, usecolormap: true, highlightcolor: '#fff', project: { z: false } },
        },
      },
    ];
  }, [grid, t]);

  const layout = useMemo<Partial<Plotly.Layout> | null>(() => {
    if (!grid) return null;

    const tickLabels = grid.x.map(deltaTickLabel);

    // Aim for ~10 X labels and ~8 Y labels regardless of grid density. Plotly
    // shows every value otherwise, which collides into an unreadable smear at
    // 91 deltas / 240 CMM tenors.
    const xStride = Math.max(1, Math.floor(grid.x.length / 10));
    const yStride = Math.max(1, Math.floor(grid.y.length / 8));
    const xTickVals = grid.x.filter((_, i) => i % xStride === 0);
    const xTickText = tickLabels.filter((_, i) => i % xStride === 0);
    const yTickVals = grid.y.filter((_, i) => i % yStride === 0);
    const yTickText = grid.yLabels.filter((_, i) => i % yStride === 0);

    return {
      autosize: true,
      paper_bgcolor: '#0A0A0A',
      plot_bgcolor: '#0A0A0A',
      font: { family: "'IBM Plex Mono', monospace", size: 11, color: '#555B5E' },
      margin: { l: 0, r: 0, t: 0, b: 0 },
      scene: {
        ...SCENE_DEFAULTS,
        // Plotly resets scene.camera on every react() call unless uirevision
        // stays stable. Keying on the user-facing selectors preserves rotation
        // across the 15s surface refetch and only resets on explicit switch.
        uirevision: `${localUnderlying}-${selectedVenue}-${tenorMode}`,
        xaxis: {
          ...SCENE_DEFAULTS.xaxis,
          title: '' as never,
          tickvals: xTickVals,
          ticktext: xTickText,
        },
        yaxis: {
          ...SCENE_DEFAULTS.yaxis,
          title: '' as never,
          tickvals: yTickVals,
          ticktext: yTickText,
        },
        zaxis: {
          ...SCENE_DEFAULTS.zaxis,
          title: '' as never,
          ticksuffix: '%',
        },
        camera: { eye: { x: 1.5, y: -1.5, z: 0.7 } },
        aspectratio: { x: 1.4, y: 1.2, z: 0.8 },
      },
    };
  }, [grid, localUnderlying, selectedVenue, tenorMode]);

  if (isLoading || !data) {
    return (
      <div className={styles.wrap}>
        <Spinner size="md" label={ts('loading3d')} />
      </div>
    );
  }

  if (!grid || !plotData || !layout) {
    return <div className={styles.empty}>{t('noData')}</div>;
  }

  const logo = getTokenLogo(localUnderlying);

  const venueOptions = [
    { value: 'average', label: t('average') },
    ...VENUE_LIST.map((v) => ({ value: v.id, label: v.label })),
  ];

  const tenorOptions: { value: TenorMode; label: string }[] = [
    { value: 'listed', label: t('listed') },
    { value: 'cmm', label: t('cmm') },
  ];

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.title}>{t('title')}</span>
        <InfoTip label={t('title')} title={t('title')} align="start">
          <SurfaceTipBody />
        </InfoTip>
        {setLocalUnderlying && (
          <DropdownPicker
            size="sm"
            value={localUnderlying}
            onChange={setLocalUnderlying}
            icon={logo ? <img src={logo} alt="" className={styles.tokenLogo} /> : undefined}
            options={underlyings.map((u) => ({ value: u, label: u }))}
          />
        )}
        {!tradfi && (
          <DropdownPicker
            size="sm"
            value={selectedVenue}
            onChange={setSelectedVenue}
            options={venueOptions}
          />
        )}
        <DropdownPicker
          size="sm"
          value={tenorMode}
          onChange={(v) => setTenorMode(v as TenorMode)}
          options={tenorOptions}
        />
      </div>
      <div className={styles.chartArea}>
        <Plot
          data={plotData}
          layout={layout}
          config={PLOTLY_3D_CONFIG}
          useResizeHandler
          style={{ width: '100%', height: '100%' }}
        />
      </div>
    </div>
  );
}
