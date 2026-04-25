import { useEffect, useMemo, useRef, useState } from 'react';
import type { EnrichedChainResponse } from '@shared/enriched';

import { useAppStore } from '@stores/app-store';
import { AssetPickerButton, Spinner, VenuePickerButton } from '@components/ui';
import { fmtUsdCompact, fmtCompact, formatExpiry } from '@lib/format';
import { VENUES } from '@lib/venue-meta';
import { DvolChart } from '@features/dvol';
import { useAllExpiriesChain } from './queries';
import VolCurves from './VolCurves';
import DeltaCurves from './DeltaCurves';
import OiSummary from './OiSummary';
import styles from './AnalyticsView.module.css';

// ── Data aggregation helpers ────────────────────────────────────

interface VenueVolume {
  venue: string;
  volume: number;
  oi: number;
}

type OiMode = 'contracts' | 'notional';

interface VenueOi {
  venue: string;
  callOi: number;
  putOi: number;
}

interface ExpiryOi {
  expiry: string;
  callOi: number;
  putOi: number;
}

interface StrikeOi {
  strike: number;
  callOi: number;
  putOi: number;
  venues: VenueOi[];
  expiries: ExpiryOi[];
}

interface ExpiryPcr {
  expiry: string;
  dte: number;
  callOi: number;
  putOi: number;
  ratio: number;
}

// Use the enrichment layer's pre-computed USD values. These are either
// venue-native (OKX oiUsd, Binance sumOpenInterestUsd) or computed from
// raw × underlyingPrice (Deribit, Derive). No guessing multipliers here.
function aggregateVenueVolume(chains: EnrichedChainResponse[]): VenueVolume[] {
  const map = new Map<string, { volume: number; oi: number }>();

  for (const chain of chains) {
    for (const strike of chain.strikes) {
      for (const side of [strike.call, strike.put]) {
        for (const [venue, q] of Object.entries(side.venues)) {
          const prev = map.get(venue) ?? { volume: 0, oi: 0 };
          prev.oi += q?.openInterestUsd ?? 0;
          prev.volume += q?.volume24hUsd ?? 0;
          map.set(venue, prev);
        }
      }
    }
  }

  return [...map.entries()]
    .map(([venue, d]) => ({ venue, volume: d.volume, oi: d.oi }))
    .filter((d) => d.oi > 0 || d.volume > 0)
    .sort((a, b) => b.oi - a.oi);
}

interface StrikeAcc {
  callOi: number;
  putOi: number;
  venues: Map<string, { callOi: number; putOi: number }>;
  expiries: Map<string, { callOi: number; putOi: number }>;
}

function aggregateStrikeOi(
  chains: EnrichedChainResponse[],
  spotPrice: number | null,
  mode: OiMode,
): StrikeOi[] {
  const readOi = mode === 'notional'
    ? (q: { openInterestUsd: number | null } | undefined) => q?.openInterestUsd ?? 0
    : (q: { openInterest: number | null } | undefined) => q?.openInterest ?? 0;
  const map = new Map<number, StrikeAcc>();

  for (const chain of chains) {
    for (const strike of chain.strikes) {
      const prev = map.get(strike.strike) ?? { callOi: 0, putOi: 0, venues: new Map(), expiries: new Map() };
      const ep = prev.expiries.get(chain.expiry) ?? { callOi: 0, putOi: 0 };
      for (const [venue, q] of Object.entries(strike.call.venues)) {
        const val = readOi(q);
        prev.callOi += val;
        ep.callOi += val;
        const vp = prev.venues.get(venue) ?? { callOi: 0, putOi: 0 };
        vp.callOi += val;
        prev.venues.set(venue, vp);
      }
      for (const [venue, q] of Object.entries(strike.put.venues)) {
        const val = readOi(q);
        prev.putOi += val;
        ep.putOi += val;
        const vp = prev.venues.get(venue) ?? { callOi: 0, putOi: 0 };
        vp.putOi += val;
        prev.venues.set(venue, vp);
      }
      prev.expiries.set(chain.expiry, ep);
      map.set(strike.strike, prev);
    }
  }

  const band = spotPrice ? spotPrice * 0.3 : Infinity;
  return [...map.entries()]
    .filter(([strike]) => !spotPrice || Math.abs(strike - spotPrice) <= band)
    .filter(([, d]) => d.callOi > 0 || d.putOi > 0)
    .map(([strike, d]) => ({
      strike,
      callOi: d.callOi,
      putOi: d.putOi,
      venues: [...d.venues.entries()]
        .map(([venue, v]) => ({ venue, ...v }))
        .filter((v) => v.callOi > 0 || v.putOi > 0)
        .sort((a, b) => b.callOi + b.putOi - (a.callOi + a.putOi)),
      expiries: [...d.expiries.entries()]
        .map(([expiry, v]) => ({ expiry, ...v }))
        .filter((v) => v.callOi > 0 || v.putOi > 0)
        .sort((a, b) => b.callOi + b.putOi - (a.callOi + a.putOi)),
    }))
    .sort((a, b) => a.strike - b.strike);
}

function computeMaxPain(chains: EnrichedChainResponse[]): number | null {
  const strikeOi = new Map<number, { callOi: number; putOi: number }>();
  for (const chain of chains) {
    for (const strike of chain.strikes) {
      const prev = strikeOi.get(strike.strike) ?? { callOi: 0, putOi: 0 };
      for (const q of Object.values(strike.call.venues)) prev.callOi += q?.openInterest ?? 0;
      for (const q of Object.values(strike.put.venues)) prev.putOi += q?.openInterest ?? 0;
      strikeOi.set(strike.strike, prev);
    }
  }

  const strikes = [...strikeOi.entries()];
  if (strikes.length === 0) return null;

  let minPayout = Infinity;
  let maxPainStrike: number | null = null;

  for (const [settlement] of strikes) {
    let totalPayout = 0;
    for (const [strike, oi] of strikes) {
      if (settlement > strike) totalPayout += (settlement - strike) * oi.callOi;
      if (settlement < strike) totalPayout += (strike - settlement) * oi.putOi;
    }
    if (totalPayout < minPayout) {
      minPayout = totalPayout;
      maxPainStrike = settlement;
    }
  }

  return maxPainStrike;
}

function aggregateExpiryPcr(chains: EnrichedChainResponse[]): ExpiryPcr[] {
  return chains
    .map((chain) => {
      let callOi = 0;
      let putOi = 0;
      for (const strike of chain.strikes) {
        for (const q of Object.values(strike.call.venues)) callOi += q?.openInterest ?? 0;
        for (const q of Object.values(strike.put.venues)) putOi += q?.openInterest ?? 0;
      }
      return {
        expiry: chain.expiry,
        dte: chain.dte,
        callOi,
        putOi,
        ratio: callOi > 0 ? putOi / callOi : 0,
      };
    })
    .filter((r) => r.callOi > 0 || r.putOi > 0);
}

// ── Sub-components ──────────────────────────────────────────────

function VenueVolumeChart({ data }: { data: VenueVolume[] }) {
  const maxOi = Math.max(...data.map((d) => d.oi), 1);

  if (data.length === 0) return null;

  return (
    <div className={styles.card}>
      <div className={styles.cardTitle}>Open Interest & Volume by Venue</div>
      <div className={styles.cardSubtitle}>USD notional · aggregated across all expiries</div>
      <div className={styles.venueHeader}>
        <span />
        <span />
        <span className={styles.colLabel}>OI</span>
        <span className={styles.colLabel}>24h Vol</span>
      </div>
      <div className={styles.venueList}>
        {data.map((d) => {
          const meta = VENUES[d.venue];
          const pct = (d.oi / maxOi) * 100;
          return (
            <div key={d.venue} className={styles.venueRow}>
              <div className={styles.venueLabel}>
                {meta?.logo && <img src={meta.logo} className={styles.venueLogo} alt="" />}
                <span>{meta?.shortLabel ?? d.venue}</span>
              </div>
              <div className={styles.barTrack}>
                <div className={styles.bar} style={{ width: `${pct}%` }} />
              </div>
              <span className={styles.statPrimary}>{fmtUsdCompact(d.oi)}</span>
              <span className={styles.statDim}>{fmtUsdCompact(d.volume)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PcrChart({ data }: { data: ExpiryPcr[] }) {
  return (
    <div className={styles.card}>
      <div className={styles.cardTitle}>Put/Call OI Ratio by Expiry</div>
      <div className={styles.pcrList}>
        {data.map((d) => {
          const totalOi = d.callOi + d.putOi;
          const callPct = totalOi > 0 ? (d.callOi / totalOi) * 100 : 50;
          return (
            <div key={d.expiry} className={styles.pcrRow}>
              <div className={styles.pcrLabel}>
                <span>{formatExpiry(d.expiry)}</span>
                <span className={styles.dteBadge} data-urgent={d.dte <= 1}>
                  {d.dte}d
                </span>
              </div>
              <div className={styles.pcrBar}>
                <div className={styles.pcrCall} style={{ width: `${callPct}%` }} />
                <div className={styles.pcrPut} style={{ width: `${100 - callPct}%` }} />
              </div>
              <div
                className={styles.pcrRatio}
                data-bullish={d.ratio < 0.7}
                data-bearish={d.ratio > 1.3}
              >
                {d.ratio.toFixed(2)}
              </div>
            </div>
          );
        })}
        <div className={styles.pcrLegend}>
          <span className={styles.pcrLegendDot} data-type="call" /> Calls
          <span className={styles.pcrLegendDot} data-type="put" /> Puts
          <span className={styles.pcrLegendNote}>&lt;0.7 bullish · &gt;1.3 bearish</span>
        </div>
      </div>
    </div>
  );
}

const EXPIRY_COLORS = [
  '#00E997', '#CB3855', '#50D2C1', '#F0B90B', '#0052FF',
  '#F7A600', '#25FAAF', '#8B5CF6', '#EC4899', '#6366F1',
  '#A855F7', '#14B8A6',
];

function OiStrikeTooltip({
  data,
  tooltipPos,
  hoveredStrike,
  expiryColorMap,
  fmt,
}: {
  data: StrikeOi[];
  tooltipPos: { x: number; y: number };
  hoveredStrike: number;
  expiryColorMap: Map<string, string>;
  fmt: (v: number | null | undefined) => string;
}) {
  const hovered = data.find((d) => d.strike === hoveredStrike);
  if (!hovered) return null;

  return (
    <div
      className={styles.oiTooltip}
      style={{ left: tooltipPos.x + 16, top: tooltipPos.y - 8 }}
    >
      <div className={styles.oiTooltipTitle}>{hovered.strike.toLocaleString()}</div>
      <div className={styles.oiTooltipColumns}>
        {hovered.venues.length > 0 && (
          <div className={styles.oiTooltipCol}>
            <div className={styles.oiTooltipSection}>By Venue</div>
            <div className={styles.oiTooltipHeader}>
              <span />
              <span>Calls</span>
              <span>Puts</span>
            </div>
            {hovered.venues.map((v) => {
              const meta = VENUES[v.venue];
              return (
                <div key={v.venue} className={styles.oiTooltipRow}>
                  <span className={styles.oiTooltipVenue}>
                    {meta?.logo && <img src={meta.logo} className={styles.venueLogo} alt="" />}
                    {meta?.shortLabel ?? v.venue}
                  </span>
                  <span className={styles.oiCall}>{fmt(v.callOi)}</span>
                  <span className={styles.oiPut}>{fmt(v.putOi)}</span>
                </div>
              );
            })}
          </div>
        )}

        {hovered.expiries.length > 1 && (
          <div className={styles.oiTooltipCol}>
            <div className={styles.oiTooltipSection}>By Expiry</div>
            <div className={styles.oiTooltipHeader}>
              <span />
              <span>Calls</span>
              <span>Puts</span>
            </div>
            {hovered.expiries.map((ep) => (
              <div key={ep.expiry} className={styles.oiTooltipRow}>
                <span className={styles.oiTooltipVenue}>
                  <span
                    className={styles.oiTooltipDot}
                    style={{ background: expiryColorMap.get(ep.expiry) }}
                  />
                  {formatExpiry(ep.expiry)}
                </span>
                <span className={styles.oiCall}>{fmt(ep.callOi)}</span>
                <span className={styles.oiPut}>{fmt(ep.putOi)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function useScrollToRef(
  listRef: React.RefObject<HTMLDivElement | null>,
  targetRef: React.RefObject<HTMLDivElement | null>,
  deps: unknown[],
) {
  useEffect(() => {
    if (targetRef.current && listRef.current) {
      const list = listRef.current;
      const target = targetRef.current;
      const offset =
        target.offsetTop - list.offsetTop - list.clientHeight / 2 + target.clientHeight / 2;
      list.scrollTop = Math.max(0, offset);
    }
  }, deps);
}

function OiByStrikeChart({
  chains,
  spotPrice,
}: {
  chains: EnrichedChainResponse[];
  spotPrice: number | null;
}) {
  const [mode, setMode] = useState<OiMode>('contracts');
  const [hiddenExpiries, setHiddenExpiries] = useState<Set<string>>(new Set());
  const [hoveredStrike, setHoveredStrike] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const spotRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  const sortedExpiries = useMemo(() => chains.map((c) => c.expiry).sort(), [chains]);
  const expiryColorMap = useMemo(
    () => new Map(sortedExpiries.map((exp, i) => [exp, EXPIRY_COLORS[i % EXPIRY_COLORS.length]!])),
    [sortedExpiries],
  );

  const filteredChains = useMemo(
    () => chains.filter((c) => !hiddenExpiries.has(c.expiry)),
    [chains, hiddenExpiries],
  );
  const data = useMemo(
    () => aggregateStrikeOi(filteredChains, spotPrice, mode),
    [filteredChains, spotPrice, mode],
  );
  const maxPain = useMemo(() => computeMaxPain(filteredChains), [filteredChains]);
  const fmt = mode === 'notional' ? fmtUsdCompact : fmtCompact;

  const maxOi = Math.max(...data.map((d) => Math.max(d.callOi, d.putOi)), 1);

  const spotStrike = useMemo(
    () =>
      spotPrice != null
        ? data.reduce<number | null>((best, d) => {
            if (best === null) return d.strike;
            return Math.abs(d.strike - spotPrice) < Math.abs(best - spotPrice) ? d.strike : best;
          }, null)
        : null,
    [data, spotPrice],
  );

  const maxPainStrike = useMemo(
    () =>
      maxPain != null
        ? data.reduce<number | null>((best, d) => {
            if (best === null) return d.strike;
            return Math.abs(d.strike - maxPain) < Math.abs(best - maxPain) ? d.strike : best;
          }, null)
        : null,
    [data, maxPain],
  );

  useScrollToRef(listRef, spotRef, [data, spotStrike]);

  const handleRowMouse = (strike: number, e: React.MouseEvent) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    setHoveredStrike(strike);
    setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const toggleExpiry = (expiry: string) => {
    setHiddenExpiries((prev) => {
      const next = new Set(prev);
      if (next.has(expiry)) next.delete(expiry);
      else next.add(expiry);
      return next;
    });
  };

  return (
    <div className={styles.card} ref={cardRef} style={{ position: 'relative' }}>
      <div className={styles.oiHeader}>
        <div className={styles.cardTitle}>Open Interest by Strike</div>
        <div className={styles.oiControls}>
          <div className={styles.oiToggle}>
            <button
              className={styles.oiToggleBtn}
              data-active={mode === 'contracts' || undefined}
              onClick={() => setMode('contracts')}
            >
              Contracts
            </button>
            <button
              className={styles.oiToggleBtn}
              data-active={mode === 'notional' || undefined}
              onClick={() => setMode('notional')}
            >
              Notional
            </button>
          </div>
          {maxPain != null && (
            <div className={styles.maxPainBadge}>
              Max Pain: <strong>{maxPain.toLocaleString()}</strong>
            </div>
          )}
        </div>
      </div>

      <div className={styles.curveLegend}>
        {sortedExpiries.map((expiry) => {
          const active = !hiddenExpiries.has(expiry);
          return (
            <button
              key={expiry}
              type="button"
              className={styles.curveLegendItem}
              data-active={active || undefined}
              onClick={() => toggleExpiry(expiry)}
            >
              <span className={styles.curveLegendDot} style={{ background: expiryColorMap.get(expiry) }} />
              {formatExpiry(expiry)}
            </button>
          );
        })}
      </div>

      <div className={styles.oiList} ref={listRef}>
        {data.map((d) => {
          const isSpot = d.strike === spotStrike;
          const isMaxPain = d.strike === maxPainStrike;
          const callPct = (d.callOi / maxOi) * 100;
          const putPct = (d.putOi / maxOi) * 100;
          return (
            <div
              key={d.strike}
              className={styles.oiRow}
              data-spot={isSpot || undefined}
              data-maxpain={isMaxPain || undefined}
              ref={isSpot ? spotRef : undefined}
              onMouseEnter={(e) => handleRowMouse(d.strike, e)}
              onMouseMove={(e) => handleRowMouse(d.strike, e)}
              onMouseLeave={() => { setHoveredStrike(null); setTooltipPos(null); }}
            >
              <div className={styles.oiStrike} data-spot={isSpot || undefined} data-maxpain={isMaxPain || undefined}>
                {d.strike.toLocaleString()}
                {isSpot && <span className={styles.spotTag}>SPOT</span>}
                {isMaxPain && !isSpot && <span className={styles.maxPainTag}>MP</span>}
              </div>
              <div className={styles.oiBars}>
                <div className={styles.oiBarLeft}>
                  <div className={styles.oiBarCall} style={{ width: `${callPct}%` }} />
                </div>
                <div className={styles.oiBarRight}>
                  <div className={styles.oiBarPut} style={{ width: `${putPct}%` }} />
                </div>
              </div>
              <div className={styles.oiValues}>
                <span className={styles.oiCall}>{fmt(d.callOi)}</span>
                <span className={styles.oiPut}>{fmt(d.putOi)}</span>
              </div>
            </div>
          );
        })}
      </div>

      {hoveredStrike != null && tooltipPos && (
        <OiStrikeTooltip
          data={data}
          tooltipPos={tooltipPos}
          hoveredStrike={hoveredStrike}
          expiryColorMap={expiryColorMap}
          fmt={fmt}
        />
      )}

      <div className={styles.oiLegend}>
        <span className={styles.pcrLegendDot} data-type="call" /> Call OI
        <span className={styles.pcrLegendDot} data-type="put" /> Put OI
        {maxPain != null && (
          <>
            <span className={styles.maxPainDot} /> Max Pain
          </>
        )}
      </div>
    </div>
  );
}

// ── Main view ───────────────────────────────────────────────────

export default function AnalyticsView() {
  const underlying = useAppStore((s) => s.underlying);
  const activeVenues = useAppStore((s) => s.activeVenues);
  const { data: chains, isLoading } = useAllExpiriesChain(underlying, activeVenues);

  if (isLoading || !chains) {
    return (
      <div className={styles.view}>
        <Spinner size="lg" label="Loading analytics…" />
      </div>
    );
  }

  const spotPrice =
    chains.find((c) => c.stats.forwardPriceUsd != null)?.stats.forwardPriceUsd ?? null;
  const venueVolume = aggregateVenueVolume(chains);
  const expiryPcr = aggregateExpiryPcr(chains);

  return (
    <div className={styles.view}>
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <span className={styles.title}>Analytics</span>
          <AssetPickerButton />
          <VenuePickerButton />
        </div>
        <span className={styles.subtitle}>
          Aggregated across {chains.length} expiries · {activeVenues.length} venues
        </span>
      </div>

      <div className={styles.grid}>
        <VenueVolumeChart data={venueVolume} />
        <OiSummary chains={chains} />
        <VolCurves chains={chains} spotPrice={spotPrice} />
        <DeltaCurves chains={chains} spotPrice={spotPrice} />
        <PcrChart data={expiryPcr} />
        <OiByStrikeChart chains={chains} spotPrice={spotPrice} />
        <div className={styles.dvolWrap}>
          <DvolChart />
        </div>
      </div>
    </div>
  );
}
