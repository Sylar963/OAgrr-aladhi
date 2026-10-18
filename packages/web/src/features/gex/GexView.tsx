import { AssetPickerButton, EmptyState, Spinner, VenuePickerButton } from '@components/ui';
import { useAllExpiriesGex, useChainQuery, useExpiries } from '@features/chain/queries';
import { useIsMobile } from '@hooks/useIsMobile';
import { dteDays, fmtUsd, formatExpiry } from '@lib/format';
import { VENUE_IDS } from '@lib/venue-meta';
import type { SpotCandleCurrency } from '@shared/common';
import type { GexStrike } from '@shared/enriched';
import { useAppStore } from '@stores/app-store';
import { useEffect, useMemo, useRef, useState } from 'react';
import GexBandsChart from './GexBandsChart';
import { computeGammaWalls, flowAttributedShare, formatGexM, gexAtSpot } from './gex-wall-utils';
import styles from './GexView.module.css';

type Mode = 'all' | string;
type Version = 'bars' | 'bands';

// The bands chart draws on daily spot candles, which only exist for these.
function isBandsCurrency(c: string): c is SpotCandleCurrency {
  return c === 'BTC' || c === 'ETH' || c === 'HYPE';
}

export default function GexView() {
  const underlying = useAppStore((s) => s.underlying);
  const activeVenues = useAppStore((s) => s.activeVenues);

  const { data: expiriesData } = useExpiries(underlying);
  const expiries = expiriesData?.expiries ?? [];

  // Default to 2nd expiry (more OI than the nearest 1d) — "all" mode is opt-in.
  const [mode, setMode] = useState<Mode>('');
  useEffect(() => {
    if (mode === 'all') return;
    if (expiries.length > 0 && (!mode || !expiries.includes(mode))) {
      setMode(expiries.length > 1 ? expiries[1]! : expiries[0]!);
    }
  }, [expiries, mode]);

  const isAll = mode === 'all';
  const allVenues = VENUE_IDS.every((v) => activeVenues.includes(v));

  const isMobile = useIsMobile();
  const [showExplain, setShowExplain] = useState(false);

  const [version, setVersion] = useState<Version>('bars');
  const bandsAvailable = isBandsCurrency(underlying);
  const effectiveVersion: Version = version === 'bands' && bandsAvailable ? 'bands' : 'bars';

  const { data: chain, isLoading: chainLoading } = useChainQuery(
    underlying,
    isAll ? '' : mode,
    activeVenues,
    { enabled: !isAll },
  );
  const { data: allGex, isLoading: allLoading } = useAllExpiriesGex(underlying, activeVenues, {
    enabled: isAll,
  });

  const gex: GexStrike[] = isAll ? (allGex?.gex ?? []) : (chain?.gex ?? []);
  const gexProfile = isAll ? allGex?.gexProfile : chain?.gexProfile;
  const spotPrice = isAll ? (allGex?.spotPrice ?? null) : (chain?.stats.forwardPriceUsd ?? null);
  const isLoading = isAll ? allLoading : chainLoading;

  const walls = useMemo(
    () => computeGammaWalls(gex, spotPrice, gexProfile),
    [gex, spotPrice, gexProfile],
  );
  const netAtSpot = gexAtSpot(gexProfile);
  const flowShare = flowAttributedShare(gex);
  const flowShareAt = (strike: number | null) =>
    strike == null ? undefined : gex.find((g) => g.strike === strike)?.flowShare;

  const barsRef = useRef<HTMLDivElement | null>(null);
  const spotRowRef = useRef<HTMLDivElement | null>(null);
  const hasCenteredBarsRef = useRef(false);

  const maxMagnitude = Math.max(...gex.map((g) => Math.abs(g.gexUsdMillions)), 1e-9);
  const sorted = [...gex].sort((a, b) => b.strike - a.strike);
  const nonzero = gex.filter((g) => Math.abs(g.gexUsdMillions) > 1e-6);
  const spotStrike =
    spotPrice != null
      ? nonzero.reduce<number | null>((best, row) => {
          if (best == null) return row.strike;
          return Math.abs(row.strike - spotPrice) < Math.abs(best - spotPrice) ? row.strike : best;
        }, null)
      : null;
  const activeVenueKey = activeVenues.join(',');

  useEffect(() => {
    hasCenteredBarsRef.current = false;
  }, [activeVenueKey, mode, underlying]);

  useEffect(() => {
    if (hasCenteredBarsRef.current || effectiveVersion !== 'bars') return;
    if (!barsRef.current || !spotRowRef.current) return;

    const list = barsRef.current;
    const row = spotRowRef.current;
    const offset = row.offsetTop - list.offsetTop - list.clientHeight / 2 + row.clientHeight / 2;
    list.scrollTop = Math.max(0, offset);
    hasCenteredBarsRef.current = true;
  }, [activeVenueKey, effectiveVersion, mode, nonzero.length, spotStrike, underlying]);

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
            <AssetPickerButton />
            <VenuePickerButton />
            <div className={styles.gexModeToggle}>
              <button
                type="button"
                className={styles.gexModeBtn}
                data-active={effectiveVersion === 'bars' || undefined}
                onClick={() => setVersion('bars')}
              >
                Bars
              </button>
              <button
                type="button"
                className={styles.gexModeBtn}
                data-active={effectiveVersion === 'bands' || undefined}
                onClick={() => bandsAvailable && setVersion('bands')}
                disabled={!bandsAvailable}
                title={bandsAvailable ? undefined : 'Gamma bands support BTC/ETH/HYPE only'}
              >
                Bands
              </button>
            </div>
          </div>
          <span className={styles.subtitle}>
            Dealer gamma per strike · $M of hedging per 1% spot move
          </span>
        </div>
        {spotPrice != null && <div className={styles.spotBadge}>Spot: {fmtUsd(spotPrice)}</div>}
      </div>

      <div className={styles.expiryPicker}>
        <button
          key="all"
          className={styles.expiryBtn}
          data-active={isAll}
          onClick={() => setMode('all')}
          title="Sum GEX across every listed expiry — closer to total dealer hedging pressure than a single tenor"
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
          detail={
            isAll
              ? 'Venues report no open interest yet. Try again once the runtimes have warmed.'
              : 'Try a further-dated expiry with more open interest.'
          }
        />
      ) : (
        <>
          {isMobile ? (
            <button className={styles.explainToggle} onClick={() => setShowExplain((v) => !v)}>
              <span className={styles.explainToggleLabel}>
                <span className={styles.explainDot} data-type="positive" /> Magnet
                <span className={styles.explainDot} data-type="negative" /> Accelerator
              </span>
              <span className={styles.explainToggleChevron} data-expanded={showExplain}>
                ⓘ
              </span>
            </button>
          ) : null}
          <div className={styles.levels}>
            {netAtSpot != null && (
              <span
                className={styles.level}
                title="Total dealer GEX at the current spot. Positive: dealers long gamma (dampening). Negative: short gamma (amplifying)."
              >
                Net at spot
                <span
                  className={styles.levelValue}
                  data-type={netAtSpot >= 0 ? 'positive' : 'negative'}
                >
                  {formatGexM(netAtSpot)} · {netAtSpot >= 0 ? 'long γ' : 'short γ'}
                </span>
              </span>
            )}
            <span
              className={styles.level}
              title="Spot level where total dealer GEX changes sign, found by re-pricing every contract's gamma across ±20% of spot"
            >
              Flip
              <span className={styles.levelValue}>
                {walls.gammaFlip != null ? Math.round(walls.gammaFlip).toLocaleString() : '—'}
              </span>
            </span>
            <WallLevel label="Call wall" strike={walls.callWall} flowShare={flowShareAt(walls.callWall)} />
            <WallLevel label="Put wall" strike={walls.putWall} flowShare={flowShareAt(walls.putWall)} />
            {flowShare != null && (
              <span
                className={styles.level}
                title="Share of gross gamma whose dealer sign comes from observed taker flow. The rest is open interest that predates the flow book, signed by the naive prior (dealers long calls, short puts)."
              >
                Flow-attributed
                <span className={styles.levelValue} data-low-confidence={flowShare < 0.5}>
                  {Math.round(flowShare * 100)}%
                </span>
              </span>
            )}
          </div>

          {(!isMobile || showExplain) && (
            <div className={styles.explain}>
              <span className={styles.explainItem} data-type="positive">
                <span className={styles.explainDot} data-type="positive" />
                Positive GEX: dealers buy dips and sell rallies to stay hedged → dampens volatility,
                pins price near high-OI strikes
              </span>
              <span className={styles.explainItem} data-type="negative">
                <span className={styles.explainDot} data-type="negative" />
                Negative GEX: dealers sell into dips and buy into rallies → amplifies moves, expect
                bigger swings
              </span>
              <span className={styles.explainFormula}>
                GEX per strike = dealer position × Gamma × Spot² × 1% × contract size, summed
                across venues. New open interest is signed by the taker side of screen and block
                trades in each 15-min interval (taker buys ⇒ dealer short). The flip re-prices
                every contract&apos;s gamma across spot levels and marks where the total changes
                sign.
              </span>
              <span className={styles.explainCaveat}>
                Open interest that predates the flow book keeps the naive sign (dealers long calls,
                short puts) until it closes or expires — see Flow-attributed. Faded bars and
                amber shares are mostly that prior. Treat GEX as a directional indicator, not
                ground truth.
              </span>
            </div>
          )}

          {effectiveVersion === 'bands' ? (
            <GexBandsChart
              gex={gex}
              gexProfile={gexProfile}
              spotPrice={spotPrice}
              currency={underlying as SpotCandleCurrency}
              showHistory={isAll && allVenues}
            />
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
                  const flowPct =
                    g.flowShare !== undefined ? ` · ${Math.round(g.flowShare * 100)}% flow` : '';
                  const barOpacity = g.flowShare !== undefined ? 0.35 + 0.65 * g.flowShare : 1;

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
                              style={{ width: `${pct}%`, opacity: barOpacity }}
                              title={`${g.strike}: ${formatGexM(g.gexUsdMillions)} per 1%${flowPct}`}
                            />
                          )}
                        </div>
                        <div className={styles.spine} />
                        <div className={styles.rightHalf}>
                          {positive && (
                            <div
                              className={styles.bar}
                              data-type="positive"
                              style={{ width: `${pct}%`, opacity: barOpacity }}
                              title={`${g.strike}: ${formatGexM(g.gexUsdMillions)} per 1%${flowPct}`}
                            />
                          )}
                        </div>
                      </div>
                      <div className={styles.valueLabel}>{formatGexM(g.gexUsdMillions)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function WallLevel({
  label,
  strike,
  flowShare,
}: {
  label: string;
  strike: number | null;
  flowShare: number | undefined;
}) {
  return (
    <span className={styles.level}>
      {label}
      <span className={styles.levelValue}>{strike != null ? strike.toLocaleString() : '—'}</span>
      {strike != null && flowShare !== undefined && (
        <span
          className={styles.levelValue}
          data-low-confidence={flowShare < 0.5}
          title="Share of this strike's gamma signed by observed flow"
        >
          {Math.round(flowShare * 100)}% flow
        </span>
      )}
    </span>
  );
}
