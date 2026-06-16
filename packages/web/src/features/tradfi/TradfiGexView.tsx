import { EmptyState, Spinner } from '@components/ui';
import styles from '@features/gex/GexView.module.css';
import { dteDays, fmtUsd, formatExpiry } from '@lib/format';
import type { GexStrike } from '@shared/enriched';
import { useAppStore } from '@stores/app-store';
import { useEffect, useRef, useState } from 'react';
import { useTradfiAllExpiriesGex, useTradfiChain, useTradfiExpiries } from './queries';
import TradfiGexBandsChart from './TradfiGexBandsChart';

type Mode = 'all' | string;
type Version = 'bars' | 'bands';

export default function TradfiGexView() {
  const underlying = useAppStore((s) => s.tradfiUnderlying);

  const { data: expiriesData } = useTradfiExpiries(underlying);
  const expiries = expiriesData?.expiries ?? [];

  const [mode, setMode] = useState<Mode>('');
  useEffect(() => {
    if (mode === 'all') return;
    if (expiries.length > 0 && (!mode || !expiries.includes(mode))) {
      setMode(expiries.length > 1 ? expiries[1]! : expiries[0]!);
    }
  }, [expiries, mode]);

  const isAll = mode === 'all';
  const [version, setVersion] = useState<Version>('bars');

  const { data: chain, isLoading: chainLoading } = useTradfiChain(underlying, isAll ? '' : mode);
  const { data: allGex, isLoading: allLoading } = useTradfiAllExpiriesGex(underlying, isAll);

  const gex: GexStrike[] = isAll ? (allGex?.gex ?? []) : (chain?.gex ?? []);
  const spotPrice = isAll
    ? (allGex?.spotPrice ?? null)
    : (chain?.stats.indexPriceUsd ?? chain?.stats.forwardPriceUsd ?? null);
  const isLoading = isAll ? allLoading : chainLoading;

  const maxMagnitude = Math.max(...gex.map((g) => Math.abs(g.gexUsdMillions)), 1);
  const sorted = [...gex].sort((a, b) => b.strike - a.strike);
  const nonzero = gex.filter((g) => Math.abs(g.gexUsdMillions) > 0.001);
  const spotStrike =
    spotPrice != null
      ? nonzero.reduce<number | null>((best, row) => {
          if (best == null) return row.strike;
          return Math.abs(row.strike - spotPrice) < Math.abs(best - spotPrice) ? row.strike : best;
        }, null)
      : null;

  const barsRef = useRef<HTMLDivElement | null>(null);
  const spotRowRef = useRef<HTMLDivElement | null>(null);
  const hasCenteredBarsRef = useRef(false);

  useEffect(() => {
    hasCenteredBarsRef.current = false;
  }, [mode, underlying]);

  useEffect(() => {
    if (hasCenteredBarsRef.current || version !== 'bars') return;
    if (!barsRef.current || !spotRowRef.current) return;
    const list = barsRef.current;
    const row = spotRowRef.current;
    const offset = row.offsetTop - list.offsetTop - list.clientHeight / 2 + row.clientHeight / 2;
    list.scrollTop = Math.max(0, offset);
    hasCenteredBarsRef.current = true;
  }, [version, mode, nonzero.length, spotStrike, underlying]);

  if (isLoading && gex.length === 0) {
    return (
      <div className={styles.view}>
        <Spinner size="lg" label="Loading GEX data…" />
      </div>
    );
  }

  return (
    <div className={styles.view}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.titleRow}>
            <span className={styles.title}>Gamma Exposure (GEX)</span>
            <div className={styles.gexModeToggle}>
              <button
                type="button"
                className={styles.gexModeBtn}
                data-active={version === 'bars' || undefined}
                onClick={() => setVersion('bars')}
              >
                Bars
              </button>
              <button
                type="button"
                className={styles.gexModeBtn}
                data-active={version === 'bands' || undefined}
                onClick={() => setVersion('bands')}
              >
                Bands
              </button>
            </div>
          </div>
          <span className={styles.subtitle}>Dealer hedging pressure per strike in $M</span>
        </div>
        {spotPrice != null && <div className={styles.spotBadge}>Spot: {fmtUsd(spotPrice)}</div>}
      </div>

      <div className={styles.expiryPicker}>
        <button
          key="all"
          className={styles.expiryBtn}
          data-active={isAll}
          onClick={() => setMode('all')}
          title="Sum GEX across every listed expiry"
        >
          ALL
          <span className={styles.dteBadge}>Σ</span>
        </button>
        {expiries.map((e) => {
          const dte = dteDays(e);
          return (
            <button
              key={e}
              className={styles.expiryBtn}
              data-active={e === mode}
              onClick={() => setMode(e)}
            >
              {formatExpiry(e)}
              <span className={styles.dteBadge} data-urgent={dte <= 1}>
                {dte}d
              </span>
            </button>
          );
        })}
      </div>

      {nonzero.length === 0 ? (
        <EmptyState
          icon="◈"
          title={isAll ? 'No GEX data across listed expiries' : 'No GEX data for this expiry'}
          detail="Open interest and flow populate once the chain has warmed."
        />
      ) : version === 'bands' ? (
        <TradfiGexBandsChart underlying={underlying} gex={gex} spotPrice={spotPrice} />
      ) : (
        <div className={styles.chart}>
          <div className={styles.axis}>
            <div className={styles.axisLeft}>
              <span className={styles.axisLabel}>← Negative (accelerator)</span>
            </div>
            <div className={styles.axisCenter}>0</div>
            <div className={styles.axisRight}>
              <span className={styles.axisLabel}>Positive (magnet) →</span>
            </div>
          </div>
          <div className={styles.bars} ref={barsRef}>
            {sorted.map((g) => {
              const pct = (Math.abs(g.gexUsdMillions) / maxMagnitude) * 100;
              const positive = g.gexUsdMillions >= 0;
              const isNearSpot = g.strike === spotStrike;
              return (
                <div
                  key={g.strike}
                  className={styles.barRow}
                  data-near-spot={isNearSpot || undefined}
                  ref={isNearSpot ? spotRowRef : undefined}
                >
                  <div className={styles.strikeLabel} data-near-spot={isNearSpot}>
                    {g.strike.toLocaleString()}
                    {isNearSpot && <span className={styles.spotMarker}>◄ SPOT</span>}
                  </div>
                  <div className={styles.barTrack}>
                    <div className={styles.leftHalf}>
                      {!positive && (
                        <div
                          className={styles.bar}
                          data-type="negative"
                          style={{ width: `${pct}%` }}
                          title={`${g.strike}: ${g.gexUsdMillions.toFixed(1)}M USD GEX`}
                        />
                      )}
                    </div>
                    <div className={styles.spine} />
                    <div className={styles.rightHalf}>
                      {positive && (
                        <div
                          className={styles.bar}
                          data-type="positive"
                          style={{ width: `${pct}%` }}
                          title={`${g.strike}: +${g.gexUsdMillions.toFixed(1)}M USD GEX`}
                        />
                      )}
                    </div>
                  </div>
                  <div className={styles.valueLabel}>
                    {positive ? '+' : ''}
                    {g.gexUsdMillions.toFixed(1)}M
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
