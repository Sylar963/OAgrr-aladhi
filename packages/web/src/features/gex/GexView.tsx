import { AssetPickerButton, EmptyState, Spinner, VenuePickerButton } from '@components/ui';
import { useAllExpiriesGex, useChainQuery, useExpiries } from '@features/chain/queries';
import { useIsMobile } from '@hooks/useIsMobile';
import { dteDays, fmtUsd, formatExpiry } from '@lib/format';
import { defineMessages, useLocale, useT } from '@lib/i18n';
import { VENUE_IDS } from '@lib/venue-meta';
import type { SpotCandleCurrency } from '@shared/common';
import type { GexStrike } from '@shared/enriched';
import { useAppStore } from '@stores/app-store';
import { useEffect, useMemo, useRef, useState } from 'react';
import GexBandsChart from './GexBandsChart';
import { computeGammaWalls, flowAttributedShare, formatGexM, gexAtSpot } from './gex-wall-utils';
import styles from './GexView.module.css';

const messages = defineMessages(
  {
    loading: 'Loading GEX data…',
    title: 'Gamma Exposure (GEX)',
    bars: 'Bars',
    bands: 'Bands',
    bandsOnly: 'Gamma bands support BTC/ETH/HYPE only',
    subtitle: 'Dealer gamma per strike · $M of hedging per 1% spot move',
    spot: 'Spot: {price}',
    allTip:
      'Sum GEX across every listed expiry — closer to total dealer hedging pressure than a single tenor',
    all: 'ALL',
    noDataAll: 'No GEX data across listed expiries',
    noDataExpiry: 'No GEX data for this expiry',
    noDataAllDetail: 'Venues report no open interest yet. Try again once the runtimes have warmed.',
    noDataExpiryDetail: 'Try a further-dated expiry with more open interest.',
    magnet: 'Magnet',
    accelerator: 'Accelerator',
    netAtSpotTip:
      'Total dealer GEX at the current spot. Positive: dealers long gamma (dampening). Negative: short gamma (amplifying).',
    netAtSpot: 'Net at spot',
    flipTip:
      "Spot level where total dealer GEX changes sign, found by re-pricing every contract's gamma across ±20% of spot",
    flip: 'Flip',
    callWall: 'Call wall',
    putWall: 'Put wall',
    flowShareTip:
      'Share of gross gamma whose dealer sign comes from observed taker flow. The rest is open interest that predates the flow book, signed by the naive prior (dealers long calls, short puts).',
    flowAttributed: 'Flow-attributed',
    positiveExplain:
      'Positive GEX: dealers buy dips and sell rallies to stay hedged → dampens volatility, pins price near high-OI strikes',
    negativeExplain:
      'Negative GEX: dealers sell into dips and buy into rallies → amplifies moves, expect bigger swings',
    formula:
      "GEX per strike = dealer position × Gamma × Spot² × 1% × contract size, summed across venues. New open interest is signed by the taker side of screen and block trades in each 15-min interval (taker buys ⇒ dealer short). The flip re-prices every contract's gamma across spot levels and marks where the total changes sign.",
    caveat:
      'Open interest that predates the flow book keeps the naive sign (dealers long calls, short puts) until it closes or expires — see Flow-attributed. Faded bars and amber shares are mostly that prior. Treat GEX as a directional indicator, not ground truth.',
    axisNegative: '← Negative (accelerator)',
    axisPositive: 'Positive (magnet) →',
    barTitle: '{strike}: {value} per 1%{flow}',
    barFlow: ' · {pct}% flow',
    strikeFlowTip: "Share of this strike's gamma signed by observed flow",
    pctFlow: '{pct}% flow',
  },
  {
    loading: 'Cargando datos de GEX…',
    title: 'Exposición gamma (GEX)',
    bars: 'Barras',
    bands: 'Bandas',
    bandsOnly: 'Las bandas gamma solo admiten BTC/ETH/HYPE',
    subtitle: 'Gamma del dealer por strike · $M de cobertura por cada 1% de movimiento del spot',
    spot: 'Spot: {price}',
    allTip:
      'Suma el GEX de todos los vencimientos listados — más cercano a la presión total de cobertura del dealer que un solo plazo',
    all: 'TODOS',
    noDataAll: 'Sin datos de GEX en los vencimientos listados',
    noDataExpiry: 'Sin datos de GEX para este vencimiento',
    noDataAllDetail:
      'Los exchanges aún no reportan open interest. Inténtalo de nuevo cuando los runtimes estén listos.',
    noDataExpiryDetail: 'Prueba un vencimiento más lejano con más open interest.',
    magnet: 'Imán',
    accelerator: 'Acelerador',
    netAtSpotTip:
      'GEX total del dealer en el spot actual. Positivo: dealers long gamma (amortigua). Negativo: short gamma (amplifica).',
    netAtSpot: 'Neto en spot',
    flipTip:
      'Nivel de spot donde el GEX total del dealer cambia de signo, calculado revalorizando el gamma de cada contrato en ±20% del spot',
    flip: 'Flip',
    callWall: 'Muro de calls',
    putWall: 'Muro de puts',
    flowShareTip:
      'Porción del gamma bruto cuyo signo de dealer proviene del flujo taker observado. El resto es open interest previo al libro de flujo, con signo según el supuesto ingenuo (dealers long calls, short puts).',
    flowAttributed: 'Atribuido a flujo',
    positiveExplain:
      'GEX positivo: los dealers compran caídas y venden subidas para mantenerse cubiertos → amortigua la volatilidad, ancla el precio cerca de strikes con alto OI',
    negativeExplain:
      'GEX negativo: los dealers venden en caídas y compran en subidas → amplifica los movimientos, espera oscilaciones más grandes',
    formula:
      'GEX por strike = posición del dealer × Gamma × Spot² × 1% × tamaño del contrato, sumado entre exchanges. El nuevo open interest se firma según el lado taker de las operaciones en pantalla y en bloque en cada intervalo de 15 min (compras taker ⇒ dealer short). El flip revaloriza el gamma de cada contrato en distintos niveles de spot y marca dónde cambia de signo el total.',
    caveat:
      'El open interest previo al libro de flujo conserva el signo ingenuo (dealers long calls, short puts) hasta que se cierra o vence — ver Atribuido a flujo. Las barras atenuadas y las porciones en ámbar son mayormente ese supuesto. Trata el GEX como un indicador direccional, no como verdad absoluta.',
    axisNegative: '← Negativo (acelerador)',
    axisPositive: 'Positivo (imán) →',
    barTitle: '{strike}: {value} por 1%{flow}',
    barFlow: ' · {pct}% flujo',
    strikeFlowTip: 'Porción del gamma de este strike firmada por flujo observado',
    pctFlow: '{pct}% flujo',
  },
);

type Mode = 'all' | string;
type Version = 'bars' | 'bands';

// The bands chart draws on daily spot candles, which only exist for these.
function isBandsCurrency(c: string): c is SpotCandleCurrency {
  return c === 'BTC' || c === 'ETH' || c === 'HYPE';
}

export default function GexView() {
  const t = useT(messages);
  const locale = useLocale();
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
        <Spinner size="lg" label={t('loading')} />
      </div>
    );
  }

  return (
    <div className={styles.view}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.titleRow}>
            <span className={styles.title}>{t('title')}</span>
            <AssetPickerButton />
            <VenuePickerButton />
            <div className={styles.gexModeToggle}>
              <button
                type="button"
                className={styles.gexModeBtn}
                data-active={effectiveVersion === 'bars' || undefined}
                onClick={() => setVersion('bars')}
              >
                {t('bars')}
              </button>
              <button
                type="button"
                className={styles.gexModeBtn}
                data-active={effectiveVersion === 'bands' || undefined}
                onClick={() => bandsAvailable && setVersion('bands')}
                disabled={!bandsAvailable}
                title={bandsAvailable ? undefined : t('bandsOnly')}
              >
                {t('bands')}
              </button>
            </div>
          </div>
          <span className={styles.subtitle}>
            {t('subtitle')}
          </span>
        </div>
        {spotPrice != null && <div className={styles.spotBadge}>{t('spot', { price: fmtUsd(spotPrice) })}</div>}
      </div>

      <div className={styles.expiryPicker}>
        <button
          key="all"
          className={styles.expiryBtn}
          data-active={isAll}
          onClick={() => setMode('all')}
          title={t('allTip')}
        >
          {t('all')}
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
              {formatExpiry(e, locale)}
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
          title={isAll ? t('noDataAll') : t('noDataExpiry')}
          detail={
            isAll ? t('noDataAllDetail') : t('noDataExpiryDetail')
          }
        />
      ) : (
        <>
          {isMobile ? (
            <button className={styles.explainToggle} onClick={() => setShowExplain((v) => !v)}>
              <span className={styles.explainToggleLabel}>
                <span className={styles.explainDot} data-type="positive" /> {t('magnet')}
                <span className={styles.explainDot} data-type="negative" /> {t('accelerator')}
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
                title={t('netAtSpotTip')}
              >
                {t('netAtSpot')}
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
              title={t('flipTip')}
            >
              {t('flip')}
              <span className={styles.levelValue}>
                {walls.gammaFlip != null ? Math.round(walls.gammaFlip).toLocaleString() : '—'}
              </span>
            </span>
            <WallLevel label={t('callWall')} strike={walls.callWall} flowShare={flowShareAt(walls.callWall)} />
            <WallLevel label={t('putWall')} strike={walls.putWall} flowShare={flowShareAt(walls.putWall)} />
            {flowShare != null && (
              <span
                className={styles.level}
                title={t('flowShareTip')}
              >
                {t('flowAttributed')}
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
                {t('positiveExplain')}
              </span>
              <span className={styles.explainItem} data-type="negative">
                <span className={styles.explainDot} data-type="negative" />
                {t('negativeExplain')}
              </span>
              <span className={styles.explainFormula}>
                {t('formula')}
              </span>
              <span className={styles.explainCaveat}>
                {t('caveat')}
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
                  <span className={styles.axisLabel}>{t('axisNegative')}</span>
                </div>
                <div className={styles.axisCenter}>0</div>
                <div className={styles.axisRight}>
                  <span className={styles.axisLabel}>{t('axisPositive')}</span>
                </div>
              </div>

              <div className={styles.bars} ref={barsRef}>
                {sorted.map((g) => {
                  const pct = (Math.abs(g.gexUsdMillions) / maxMagnitude) * 100;
                  const positive = g.gexUsdMillions >= 0;
                  const isNearSpot = g.strike === spotStrike;
                  const flowPct =
                    g.flowShare !== undefined ? t('barFlow', { pct: Math.round(g.flowShare * 100) }) : '';
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
                              title={t('barTitle', {
                                strike: g.strike,
                                value: formatGexM(g.gexUsdMillions),
                                flow: flowPct,
                              })}
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
                              title={t('barTitle', {
                                strike: g.strike,
                                value: formatGexM(g.gexUsdMillions),
                                flow: flowPct,
                              })}
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
  const t = useT(messages);
  return (
    <span className={styles.level}>
      {label}
      <span className={styles.levelValue}>{strike != null ? strike.toLocaleString() : '—'}</span>
      {strike != null && flowShare !== undefined && (
        <span
          className={styles.levelValue}
          data-low-confidence={flowShare < 0.5}
          title={t('strikeFlowTip')}
        >
          {t('pctFlow', { pct: Math.round(flowShare * 100) })}
        </span>
      )}
    </span>
  );
}
