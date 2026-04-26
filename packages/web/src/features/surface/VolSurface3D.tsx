import { useMemo, useState } from 'react';

import type { IvSurfaceResponse } from '@shared/enriched';

import { Spinner, DropdownPicker, InfoTip } from '@components/ui';
import { useUnderlyings } from '@features/chain';
import { getTokenLogo } from '@lib/token-meta';
import { VENUE_IDS, VENUE_LIST } from '@lib/venue-meta';
import { formatExpiry } from '@lib/format';
import { Plot, PLOTLY_3D_CONFIG, SCENE_DEFAULTS } from './plotly';
import { deltaTickLabel } from './smile-utils';
import { useSurface } from './queries';
import styles from './VolSurface3D.module.css';

// Drop expiries thinner than this — sparse rows render as spikes/holes.
const MIN_NON_NULL_PER_ROW = 3;

const SURFACE_TIP_BODY = (
  <>
    <div>
      Implied vol across strike (X = delta), time (Y = tenor), and magnitude
      (Z = IV %, also encoded by color).
    </div>
    <ul style={{ margin: '6px 0 0', paddingLeft: 14 }}>
      <li>
        <strong>X — delta</strong>: 5Δp (deep OTM put) → ATM (0.5) → 5Δc (deep OTM call).
        Wings above ATM = skew / tail-risk premium.
      </li>
      <li>
        <strong>Y — tenor</strong>: days to expiry, near → far.
        Upward slope = contango; inversion = near-term stress.
      </li>
      <li>
        <strong>Z &amp; color</strong>: IV in %. Blue = low, white = mid, orange = high.
        Color gaps = missing venue quotes.
      </li>
      <li>
        <strong>Venue picker</strong>: single-venue vs cross-venue Average.
        Average smooths venue quirks; single venue exposes microstructure.
      </li>
    </ul>
  </>
);

interface SurfaceGrid {
  x: number[];
  y: number[];
  z: (number | null)[][];
  yLabels: string[];
  text: string[][];
}

function buildSurfaceGrid(data: IvSurfaceResponse): SurfaceGrid | null {
  const x = data.surfaceFineDeltas;
  if (!x || x.length === 0) return null;

  const sorted = data.surfaceFine
    .filter((r) => r.dte > 0)
    .slice()
    .sort((a, b) => a.dte - b.dte);

  const y: number[] = [];
  const yLabels: string[] = [];
  const z: (number | null)[][] = [];
  const text: string[][] = [];

  for (const row of sorted) {
    // Backend stores IV as fraction; chart renders percentage.
    const ivPct = row.ivs.map((v) => (v != null ? v * 100 : null));
    const filled = ivPct.filter((v) => v != null).length;
    if (filled < MIN_NON_NULL_PER_ROW) continue;

    const label = formatExpiry(row.expiry);
    y.push(row.dte);
    yLabels.push(label);
    z.push(ivPct);
    text.push(x.map(() => `${label} (${row.dte}d)`));
  }

  if (z.length === 0) return null;
  return { x, y, z, yLabels, text };
}

interface Props {
  defaultUnderlying?: string;
}

export default function VolSurface3D({ defaultUnderlying = 'BTC' }: Props) {
  const [localUnderlying, setLocalUnderlying] = useState(defaultUnderlying);
  const [selectedVenue, setSelectedVenue] = useState('average');

  const { data: underlyingsData } = useUnderlyings();
  const underlyings = underlyingsData?.underlyings ?? [];

  const venues = selectedVenue === 'average' ? VENUE_IDS : [selectedVenue];
  const { data, isLoading } = useSurface(localUnderlying, venues);

  const grid = useMemo(() => (data ? buildSurfaceGrid(data) : null), [data]);

  if (isLoading || !data) {
    return (
      <div className={styles.wrap}>
        <Spinner size="md" label="Loading 3D surface..." />
      </div>
    );
  }

  if (!grid) {
    return <div className={styles.empty}>No surface data</div>;
  }

  const logo = getTokenLogo(localUnderlying);

  const venueOptions = [
    { value: 'average', label: 'Average' },
    ...VENUE_LIST.map((v) => ({ value: v.id, label: v.label })),
  ];

  const tickLabels = grid.x.map(deltaTickLabel);

  const plotData: Partial<Plotly.PlotData>[] = [
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
      hovertemplate:
        'Delta: %{x}<br>Expiry: %{text}<br>IV: %{z:.1f}%<extra></extra>',
      contours: {
        z: { show: true, usecolormap: true, highlightcolor: '#fff', project: { z: false } },
      } as Plotly.PlotData['contours'],
    },
  ];

  const layout: Partial<Plotly.Layout> = {
    autosize: true,
    paper_bgcolor: '#0A0A0A',
    plot_bgcolor: '#0A0A0A',
    font: { family: "'IBM Plex Mono', monospace", size: 11, color: '#555B5E' },
    margin: { l: 0, r: 0, t: 0, b: 0 },
    scene: {
      ...SCENE_DEFAULTS,
      xaxis: {
        ...SCENE_DEFAULTS.xaxis,
        title: '' as never,
        tickvals: grid.x.filter((_, i) => i % 2 === 0),
        ticktext: tickLabels.filter((_, i) => i % 2 === 0),
      },
      yaxis: {
        ...SCENE_DEFAULTS.yaxis,
        title: '' as never,
        tickvals: grid.y,
        ticktext: grid.yLabels,
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

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.title}>3D IV Surface</span>
        <InfoTip label="3D IV Surface" title="3D IV Surface" align="start">
          {SURFACE_TIP_BODY}
        </InfoTip>
        <DropdownPicker
          size="sm"
          value={localUnderlying}
          onChange={setLocalUnderlying}
          icon={logo ? <img src={logo} alt="" className={styles.tokenLogo} /> : undefined}
          options={underlyings.map((u) => ({ value: u, label: u }))}
        />
        <DropdownPicker
          size="sm"
          value={selectedVenue}
          onChange={setSelectedVenue}
          options={venueOptions}
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
