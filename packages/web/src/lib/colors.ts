// ── Theme color constants ──────────────────────────────────────────────────

export const COLORS = {
  bgDeepest: '#0a0b0e',
  bgSurface: '#111318',
  bgElevated: '#181c24',
  border: 'rgba(255,255,255,0.07)',
  textPrimary: '#e8eaf0',
  textMuted: '#8b909e',
  green: '#4ade80',
  amber: '#fbbf24',
  red: '#f87171',
  blue: '#60a5fa',
  purple: '#a78bfa',
} as const;

// ── IV chip color ─────────────────────────────────────────────────────────

export type IvLevel = 'green' | 'amber' | 'red' | 'muted';

export function ivLevel(iv: number | null): IvLevel {
  if (iv == null) return 'muted';
  if (iv < 0.5) return 'green';
  if (iv < 0.65) return 'amber';
  return 'red';
}

export function ivColor(level: IvLevel): string {
  switch (level) {
    case 'green':
      return COLORS.green;
    case 'amber':
      return COLORS.amber;
    case 'red':
      return COLORS.red;
    case 'muted':
      return COLORS.textMuted;
  }
}

// ── Spread pill color ─────────────────────────────────────────────────────

export type SpreadLevel = 'green' | 'amber' | 'red';

export function spreadLevel(pct: number | null): SpreadLevel {
  if (pct == null || pct < 2.5) return 'green';
  if (pct < 4.5) return 'amber';
  return 'red';
}

// ── Forward drift semaphore ───────────────────────────────────────────────
// |Δ / atmStrike| expressed in basis points. Below 1 bps the venue's forward
// is in consensus (any price divergence reflects real MM skew). Above 3 bps
// the venue's forward is drifting and cheap/expensive option prices are
// mostly forward, not edge.

export type ForwardLevel = 'green' | 'amber' | 'red' | 'muted';

export function forwardDriftLevel(deltaBps: number | null): ForwardLevel {
  if (deltaBps == null || !Number.isFinite(deltaBps)) return 'muted';
  const m = Math.abs(deltaBps);
  if (m < 1) return 'green';
  if (m < 3) return 'amber';
  return 'red';
}

// ── Venue colors ──────────────────────────────────────────────────────────

export const VENUE_COLORS: Record<string, string> = {
  deribit: '#0052FF',
  okx: '#e8eaf0',
  binance: '#F0B90B',
  bybit: '#F7A600',
  derive: '#25FAAF',
  coincall: '#1FE086',
  thalex: '#00E5A8',
};

export function venueColor(venueId: string): string {
  return VENUE_COLORS[venueId] ?? '#8b909e';
}

// ── IV surface heatmap color ───────────────────────────────────────────────
// Maps a value in [0,1] range (normalized between min and max IV) to a color.
// 0 = green (low IV), 0.5 = amber, 1 = red (high IV)

export function heatmapColor(normalized: number): string {
  if (normalized <= 0.5) {
    // green → amber
    const t = normalized * 2;
    const r = Math.round(74 + t * (251 - 74));
    const g = Math.round(222 + t * (191 - 222));
    const b = Math.round(128 + t * (36 - 128));
    return `rgb(${r},${g},${b})`;
  } else {
    // amber → red
    const t = (normalized - 0.5) * 2;
    const r = Math.round(251 + t * (248 - 251));
    const g = Math.round(191 + t * (113 - 191));
    const b = Math.round(36 + t * (113 - 36));
    return `rgb(${r},${g},${b})`;
  }
}
