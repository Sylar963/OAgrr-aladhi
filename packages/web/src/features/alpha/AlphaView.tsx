import { EmptyState, Spinner } from '@components/ui';
import { useStrategyStore } from '@features/architect/strategy-store';
import { ExpiryBar } from '@features/chain';
import { AlphaPortfolioContext } from '@features/portfolio';
import { useIsMobile } from '@hooks/useIsMobile';
import { defineMessages, useT } from '@lib/i18n';
import type { SpreadKind } from '@lib/analytics/verticalSpread';
import type { EnrichedChainResponse, VenueId } from '@shared/enriched';
import { VENUES } from '@lib/venue-meta';
import { useAppStore } from '@stores/app-store';
import { useEffect, useMemo, useRef, useState } from 'react';
import AlphaContextStrip from './AlphaContextStrip';
import AlphaTradeSizing, { useAlphaSizing } from './AlphaTradeSizing';
import AlphaVenueOpportunities from './AlphaVenueOpportunities';
import styles from './AlphaView.module.css';
import LongStraddlePanel from './LongStraddlePanel';
import LottoScannerPanel from './LottoScannerPanel';
import ProtectivePutPanel from './ProtectivePutPanel';
import { verticalToBuilderLegs } from './radar-builder';
import CrossVenueOpportunities from './CrossVenueOpportunities';
import {
  type CrossVenueCandidate,
  type CrossVenueScan,
  scanCrossVenueSpreads,
} from './cross-venue-scanner';
import SignalCard, { type ExecutionRoute } from './SignalCard';
import SpreadBuilderPanel from './SpreadBuilderPanel';
import StraddleScannerPanel from './StraddleScannerPanel';
import {
  indicativeAtMark,
  type SpreadCandidate,
  scanSpreads,
  type VenueScan,
} from './spread-scanner';
import { computeSviRichness } from './sviRichness';
import { useAlphaMarketContext } from './useAlphaMarketContext';
import { type AlphaMarket, useAlphaMarketData } from './useAlphaMarketData';
import { useRegimeQuery } from './useRegimeQuery';
import { useVerticalSpreadAnalysis } from './useVerticalSpreadAnalysis';
import {
  formatQuantity,
  suggestVenueQuantity,
  venueSizeRule,
  type VenueQuantitySuggestion,
} from './venue-sizing';
import type { VerticalEconomics } from './vertical-pricing';
import VolSmileInset from './VolSmileInset';

type AlphaStrategy = SpreadKind | 'long-call' | 'long-put' | 'short-straddle' | 'long-straddle';
type ScannerStrategy = Exclude<AlphaStrategy, SpreadKind>;

function isScannerStrategy(strategy: AlphaStrategy): strategy is ScannerStrategy {
  return (
    strategy === 'long-call' ||
    strategy === 'long-put' ||
    strategy === 'short-straddle' ||
    strategy === 'long-straddle'
  );
}

const messages = defineMessages(
  {
    callCredit: 'Call Credit',
    putCredit: 'Put Credit',
    callDebit: 'Call Debit',
    putDebit: 'Put Debit',
    longCall: 'Long Call',
    longPut: 'Long Put',
    sellStraddle: 'Sell Straddle',
    buyStraddle: 'Buy Straddle',
    emptyEquity: 'Enter your current account equity in the builder to see dollar risk at your size.',
    emptyChain: 'Chain unavailable. Cached quotes are not used for a trade estimate.',
    emptyMarkOnly:
      '{venue} has no bids or asks on {underlying} options, only marks. Pick a venue with a live book, or get a block quote on the venue.',
    emptyQuote:
      'No eligible quote for these strikes, venue, and size. Check sizing, expiry, quote exclusions, or load an alternative below.',
    portfolioRisk: 'Existing portfolio risk · {venue}',
    strategyAria: 'Alpha strategy',
    activeVenues: '{n} ACTIVE VENUES',
    loadingChain: 'Loading chain data…',
    failedChain: 'Failed to load chain',
    checkConnection: 'Check your connection and try again.',
    noOptions: 'No options data',
    noVenuesData: 'No venues returned data for {underlying} {expiry}.',
  },
  {
    callCredit: 'Call Credit',
    putCredit: 'Put Credit',
    callDebit: 'Call Debit',
    putDebit: 'Put Debit',
    longCall: 'Long Call',
    longPut: 'Long Put',
    sellStraddle: 'Vender straddle',
    buyStraddle: 'Comprar straddle',
    emptyEquity: 'Ingresa el capital actual de tu cuenta en el builder para ver el riesgo en dólares a tu tamaño.',
    emptyChain: 'Cadena no disponible. No se usan cotizaciones en caché para estimar un trade.',
    emptyMarkOnly:
      '{venue} no tiene bids ni asks en opciones de {underlying}, solo marks. Elige un exchange con libro en vivo o pide una cotización block en el exchange.',
    emptyQuote:
      'No hay cotización elegible para estos strikes, exchange y tamaño. Revisa el tamaño, el vencimiento y las exclusiones de cotizaciones, o carga una alternativa abajo.',
    portfolioRisk: 'Riesgo actual del portafolio · {venue}',
    strategyAria: 'Estrategia Alpha',
    activeVenues: '{n} EXCHANGES ACTIVOS',
    loadingChain: 'Cargando datos de la cadena…',
    failedChain: 'No se pudo cargar la cadena',
    checkConnection: 'Revisa tu conexión e inténtalo de nuevo.',
    noOptions: 'Sin datos de opciones',
    noVenuesData: 'Ningún exchange devolvió datos para {underlying} {expiry}.',
  },
);

const STRATEGIES: ReadonlyArray<{ id: AlphaStrategy; label: keyof typeof messages.en }> = [
  { id: 'call-credit', label: 'callCredit' },
  { id: 'put-credit', label: 'putCredit' },
  { id: 'call-debit', label: 'callDebit' },
  { id: 'put-debit', label: 'putDebit' },
  { id: 'long-call', label: 'longCall' },
  { id: 'long-put', label: 'longPut' },
  { id: 'short-straddle', label: 'sellStraddle' },
  { id: 'long-straddle', label: 'buyStraddle' },
];
// TradFi has no scanner runtime yet; only the chain-local spread tabs apply.
const SPREAD_STRATEGIES = STRATEGIES.filter((item) => !isScannerStrategy(item.id));

export default function AlphaView({ market = 'crypto' }: { market?: AlphaMarket }) {
  const t = useT(messages);
  const tradfi = market === 'tradfi';
  const {
    underlying,
    expiry,
    setExpiry,
    expiries,
    venues: scanVenues,
    chainQuery,
    changeAsset,
    prefetch,
    showBuilder,
  } = useAlphaMarketData(market);
  const replaceLegs = useStrategyStore((s) => s.replaceLegs);
  const setBuilderVariant = useAppStore((s) => s.setBuilderVariant);
  const { data: chain, isLoading, error } = chainQuery;

  const isMobile = useIsMobile();
  const [strategy, setStrategy] = useState<AlphaStrategy>('call-credit');
  const isSpread = !isScannerStrategy(strategy);
  const kind: SpreadKind = isScannerStrategy(strategy) ? 'call-credit' : strategy;
  const [shortStrike, setShortStrike] = useState<number | null>(null);
  const [longStrike, setLongStrike] = useState<number | null>(null);
  const [preferredVenue, setPreferredVenue] = useState<VenueId>('thalex');
  const [preferredBuyVenue, setPreferredBuyVenue] = useState<VenueId | null>(null);
  const tradeVenue = scanVenues.includes(preferredVenue)
    ? preferredVenue
    : (busiestVenue(chain, scanVenues) ?? scanVenues[0] ?? 'thalex');
  const sizeRule = useMemo(() => venueSizeRule(chain, tradeVenue), [chain, tradeVenue]);
  const {
    sizing: storedSizing,
    update,
    quantityIsAuto,
    resetQuantity,
  } = useAlphaSizing(market, underlying);
  const venueQuantities = useVenueQuantities(
    tradfi || !quantityIsAuto || !isSpread ? undefined : chain,
    scanVenues,
    Number(storedSizing.reserve),
  );
  const tradeVenueQuantity = venueQuantities[tradeVenue];
  const sizing =
    tradeVenueQuantity != null
      ? { ...storedSizing, quantity: formatQuantity(tradeVenueQuantity) }
      : storedSizing;
  const [clock, setClock] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 5_000);
    return () => window.clearInterval(timer);
  }, []);
  const crossBuyVenue =
    preferredBuyVenue != null &&
    preferredBuyVenue !== tradeVenue &&
    scanVenues.includes(preferredBuyVenue)
      ? preferredBuyVenue
      : null;
  const scanInput = useMemo(() => {
    if (
      !chain ||
      error ||
      chain.underlying !== underlying ||
      chain.expiry !== expiry ||
      !sizing.equity.trim() ||
      !sizing.reserve.trim() ||
      !isSpread
    )
      return null;
    return {
      chain,
      venues: scanVenues,
      quantity: Number(sizing.quantity),
      equity: Number(sizing.equity),
      riskPct: Number(sizing.riskPct),
      costReserve: Number(sizing.reserve),
      nowMs: Date.now(),
    };
  }, [chain, error, underlying, expiry, scanVenues, sizing, isSpread, clock]);
  // Auto size: each venue card prices at that venue's own suggested size, so one venue's
  // minimum (Deribit 10 SOL) or order-value floor (Paradex $20) cannot blank the others.
  const scans = useMemo(() => {
    if (!scanInput) return [];
    if (Object.keys(venueQuantities).length === 0) return scanSpreads(scanInput);
    return scanInput.venues.flatMap((venue) =>
      scanSpreads({
        ...scanInput,
        venues: [venue],
        quantity: venueQuantities[venue] ?? scanInput.quantity,
      }),
    );
  }, [scanInput, venueQuantities]);
  const tradeVenueMarkOnly = scans.find((scan) => scan.venue === tradeVenue)?.markOnly ?? false;
  const markOnlyVenues = useMemo(
    () => new Set(scans.filter((scan) => scan.markOnly).map((scan) => scan.venue)),
    [scans],
  );
  const crossScans = useMemo(
    () => (scanInput && scanInput.venues.length > 1 ? scanCrossVenueSpreads(scanInput, scans) : []),
    [scanInput, scans],
  );
  const selection = findSelection(scans, crossScans, {
    sellVenue: tradeVenue,
    buyVenue: crossBuyVenue,
    kind,
    sellStrike: shortStrike,
    buyStrike: longStrike,
  });
  function loadStrikes(candidate: VerticalEconomics) {
    setStrategy(candidate.kind);
    setShortStrike(candidate.sellStrike);
    setLongStrike(candidate.buyStrike);
  }
  function selectSameVenue(candidate: SpreadCandidate) {
    setPreferredVenue(candidate.venue);
    setPreferredBuyVenue(null);
    loadStrikes(candidate);
  }
  function selectCrossVenue(candidate: CrossVenueCandidate) {
    setPreferredVenue(candidate.sellVenue);
    setPreferredBuyVenue(candidate.buyVenue);
    loadStrikes(candidate);
  }

  const builderLegs =
    chain && selection
      ? verticalToBuilderLegs(selection.candidate, selection.route, chain, tradfi)
      : null;
  function openInBuilder() {
    if (!builderLegs) return;
    replaceLegs(builderLegs, underlying);
    setExpiry(expiry);
    setBuilderVariant('v2');
    showBuilder();
  }

  const atmStrike = chain?.stats.atmStrike ?? null;

  const sortedStrikes = useMemo(() => {
    if (!chain) return null;
    return [...chain.strikes].map((s) => s.strike).sort((a, b) => a - b);
  }, [chain]);

  // Compute reasonable defaults for a given spread kind: for call-credit, short
  // ≈ ATM, long ≈ first strike above that. For put-credit, mirror image.
  const defaultsFor = (k: SpreadKind): { shortStrike: number; longStrike: number } | null => {
    if (!sortedStrikes || sortedStrikes.length < 2 || atmStrike == null) return null;
    const atmIdx = nearestIndex(sortedStrikes, atmStrike);
    if (k.startsWith('call')) {
      const shortIdx = Math.min(atmIdx + 1, sortedStrikes.length - 2);
      if (k === 'call-debit')
        return { shortStrike: sortedStrikes[shortIdx + 1]!, longStrike: sortedStrikes[shortIdx]! };
      return { shortStrike: sortedStrikes[shortIdx]!, longStrike: sortedStrikes[shortIdx + 1]! };
    }
    const shortIdx = Math.max(atmIdx - 1, 1);
    if (k === 'put-debit')
      return { shortStrike: sortedStrikes[shortIdx - 1]!, longStrike: sortedStrikes[shortIdx]! };
    return { shortStrike: sortedStrikes[shortIdx]!, longStrike: sortedStrikes[shortIdx - 1]! };
  };

  // Seed (or re-seed) leg defaults whenever the current selection isn't valid
  // for the current chain. This covers initial load AND tenor/underlying
  // changes — at the moment the *new* chain arrives, if the prior strikes
  // don't exist on it we atomically swap to fresh defaults, avoiding any
  // render where strikes are null while old data is still on screen.
  useEffect(() => {
    if (!sortedStrikes || sortedStrikes.length < 2) return;
    const strikeSet = new Set(sortedStrikes);
    const valid =
      shortStrike != null &&
      longStrike != null &&
      strikeSet.has(shortStrike) &&
      strikeSet.has(longStrike);
    if (valid) return;
    const d = defaultsFor(kind);
    if (!d) return;
    setShortStrike(d.shortStrike);
    setLongStrike(d.longStrike);
    // defaultsFor is stable per (sortedStrikes, atmStrike); listing those is sufficient.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedStrikes, atmStrike, kind, shortStrike, longStrike]);

  const { data: regime } = useRegimeQuery(tradfi ? '' : underlying);
  const marketContext = useAlphaMarketContext(underlying, !tradfi);
  const regimeDominant = regime?.dominant ?? null;

  const analysis = useVerticalSpreadAnalysis({
    chain,
    kind,
    shortStrike,
    longStrike,
    venues: scanVenues,
    regimeDominant,
  });

  const atmIv = analysis.smile?.atmIv ?? null;
  const impliedMove = atmIv != null && analysis.T != null ? atmIv * Math.sqrt(analysis.T) : null;

  const richness = useMemo(
    () => computeSviRichness(analysis.smile, analysis.T),
    [analysis.smile, analysis.T],
  );

  const builder = chain && (
    <SpreadBuilderPanel
      kind={kind}
      onKindChange={(k) => {
        if (k === kind) return;
        const d = defaultsFor(k);
        setStrategy(k);
        setPreferredBuyVenue(null);
        if (d) {
          setShortStrike(d.shortStrike);
          setLongStrike(d.longStrike);
        } else {
          setShortStrike(null);
          setLongStrike(null);
        }
      }}
      strikes={chain.strikes}
      atmStrike={atmStrike}
      shortStrike={shortStrike}
      longStrike={longStrike}
      onShortChange={setShortStrike}
      onLongChange={setLongStrike}
      forward={analysis.forward}
      T={analysis.T}
    >
      <AlphaTradeSizing
        sizing={sizing}
        update={update}
        venue={tradeVenue}
        venues={scanVenues}
        onVenue={(venue) => {
          setPreferredVenue(venue);
          setPreferredBuyVenue(null);
        }}
        underlying={underlying}
        market={market}
        sizeRule={sizeRule}
        quantityIsAuto={quantityIsAuto}
        onAutoQuantity={resetQuantity}
        markOnlyVenues={markOnlyVenues}
      />
    </SpreadBuilderPanel>
  );

  const signalStack = (
    <>
      <SignalCard
        candidate={selection?.candidate ?? null}
        route={selection?.route ?? null}
        underlying={underlying}
        spot={analysis.spot}
        impliedMove={impliedMove}
        riskBudgetPct={Number(sizing.riskPct)}
        emptyState={!sizing.equity.trim() ? 'equity' : error ? 'market' : 'quote'}
        emptyReason={
          !sizing.equity.trim()
            ? t('emptyEquity')
            : error
              ? t('emptyChain')
              : tradeVenueMarkOnly
                ? t('emptyMarkOnly', { venue: VENUES[tradeVenue]?.label ?? tradeVenue, underlying })
                : t('emptyQuote')
        }
        regime={regime ?? null}
        {...(builderLegs && { onOpenBuilder: openInBuilder })}
      />
      <AlphaVenueOpportunities
        scans={scans}
        kind={kind}
        underlying={underlying}
        quantities={venueQuantities}
        indicativeFor={(venue) =>
          chain && shortStrike != null && longStrike != null
            ? indicativeAtMark(
                chain,
                venue,
                kind.startsWith('call') ? 'call' : 'put',
                shortStrike,
                longStrike,
                venueQuantities[venue] ?? Number(sizing.quantity),
              )
            : null
        }
        sellStrike={shortStrike}
        buyStrike={longStrike}
        onSelect={selectSameVenue}
      />
      {scanVenues.length > 1 && (
        <CrossVenueOpportunities
          scans={crossScans}
          kind={kind}
          sellStrike={shortStrike}
          buyStrike={longStrike}
          loadedId={crossBuyVenue == null ? null : (selection?.id ?? null)}
          onSelect={selectCrossVenue}
        />
      )}
      <VolSmileInset
        smile={analysis.smile}
        shortStrike={shortStrike}
        longStrike={longStrike}
        richness={richness}
        T={analysis.T}
      />
      {!tradfi && (
        <details>
          <summary>{t('portfolioRisk', { venue: tradeVenue })}</summary>
          <AlphaPortfolioContext venue={tradeVenue} underlying={underlying} />
        </details>
      )}
    </>
  );

  return (
    <div className={styles.view}>
      <div className={styles.strategyBar}>
        <button type="button" className={styles.assetButton} onClick={changeAsset}>
          <span>ALPHA</span>
          <strong>{underlying}</strong>
        </button>
        <div className={styles.strategyTabs} role="tablist" aria-label={t('strategyAria')}>
          {(tradfi ? SPREAD_STRATEGIES : STRATEGIES).map((item) => (
            <button
              type="button"
              role="tab"
              aria-selected={strategy === item.id}
              data-active={strategy === item.id}
              key={item.id}
              onClick={() => {
                if (item.id === strategy) return;
                if (isScannerStrategy(item.id)) {
                  setStrategy(item.id);
                  return;
                }
                const defaults = defaultsFor(item.id);
                setStrategy(item.id);
                setPreferredBuyVenue(null);
                if (defaults) {
                  setShortStrike(defaults.shortStrike);
                  setLongStrike(defaults.longStrike);
                }
              }}
            >
              {t(item.label)}
            </button>
          ))}
        </div>
        {!tradfi && (
          <span className={styles.venueScope}>{t('activeVenues', { n: scanVenues.length })}</span>
        )}
      </div>

      {!isMobile && isSpread && (
        <ExpiryBar
          underlying={underlying}
          spotPrice={chain?.stats.forwardPriceUsd}
          expiries={expiries}
          selected={expiry}
          onSelect={setExpiry}
          onChangeAsset={changeAsset}
          {...(prefetch && { onPrefetch: prefetch })}
        />
      )}

      {!tradfi && (
        <AlphaContextStrip
          context={marketContext.data ?? null}
          strategy={strategy}
          loading={marketContext.isLoading}
        />
      )}

      {strategy === 'long-call' && (
        <div className={styles.scannerWorkspace}>
          <LottoScannerPanel underlying={underlying} venues={scanVenues} />
        </div>
      )}

      {strategy === 'long-put' && (
        <div className={styles.scannerWorkspace}>
          <ProtectivePutPanel underlying={underlying} venues={scanVenues} />
        </div>
      )}

      {strategy === 'short-straddle' && (
        <div className={styles.scannerWorkspace}>
          <StraddleScannerPanel underlying={underlying} venues={scanVenues} />
        </div>
      )}

      {strategy === 'long-straddle' && (
        <div className={styles.scannerWorkspace}>
          <LongStraddlePanel underlying={underlying} venues={scanVenues} />
        </div>
      )}

      {isSpread && isLoading && !chain && (
        <div className={styles.state}>
          <Spinner size="lg" label={t('loadingChain')} />
        </div>
      )}

      {isSpread && error && !chain && (
        <div className={styles.state}>
          <EmptyState
            icon="⚠"
            title={t('failedChain')}
            detail={error instanceof Error ? error.message : t('checkConnection')}
          />
        </div>
      )}

      {isSpread && chain && chain.strikes.length === 0 && (
        <EmptyState
          icon="∅"
          title={t('noOptions')}
          detail={t('noVenuesData', { underlying, expiry })}
        />
      )}

      {isSpread &&
        chain &&
        chain.strikes.length > 0 &&
        (isMobile ? (
          // On mobile: signal first (what users come for), then router + smile,
          // then the strike builder at the bottom (less central on small screens).
          <div className={styles.mobileStack}>
            {signalStack}
            {builder}
          </div>
        ) : (
          <div className={styles.grid}>
            {builder}
            <div className={styles.rightColumn}>{signalStack}</div>
          </div>
        ))}
    </div>
  );
}

interface SelectionQuery {
  sellVenue: VenueId;
  /** null selects the same-venue route on `sellVenue`. */
  buyVenue: VenueId | null;
  kind: SpreadKind;
  sellStrike: number | null;
  buyStrike: number | null;
}

function findSelection(
  scans: readonly VenueScan[],
  crossScans: readonly CrossVenueScan[],
  query: SelectionQuery,
): { id: string; candidate: VerticalEconomics; route: ExecutionRoute } | null {
  const matches = (c: VerticalEconomics) =>
    c.kind === query.kind && c.sellStrike === query.sellStrike && c.buyStrike === query.buyStrike;
  const { sellVenue, buyVenue } = query;
  if (buyVenue == null) {
    const candidate = scans.find((s) => s.venue === sellVenue)?.candidates.find(matches);
    return candidate
      ? { id: candidate.id, candidate, route: { sellVenue, buyVenue: sellVenue } }
      : null;
  }
  const candidate = crossScans
    .find((s) => s.sellVenue === sellVenue)
    ?.candidates.find((c) => c.buyVenue === buyVenue && matches(c));
  return candidate ? { id: candidate.id, candidate, route: { sellVenue, buyVenue } } : null;
}

const SUGGESTION_RETRY_MS = 10_000;

/**
 * Suggested size per venue for the loaded chain. A suggestion that prices pairs is kept for
 * the chain's underlying/expiry so the size does not drift with every quote patch; one that
 * prices nothing (quotes still warming) is retried after SUGGESTION_RETRY_MS.
 */
function useVenueQuantities(
  chain: EnrichedChainResponse | undefined,
  venues: readonly VenueId[],
  costReserve: number,
): Partial<Record<VenueId, number>> {
  const cache = useRef(new Map<string, VenueQuantitySuggestion & { atMs: number }>());
  return useMemo(() => {
    const quantities: Partial<Record<VenueId, number>> = {};
    if (!chain || !Number.isFinite(costReserve) || costReserve < 0) return quantities;
    const nowMs = Date.now();
    for (const venue of venues) {
      const key = `${chain.underlying}|${chain.expiry}|${venue}|${costReserve}`;
      let suggestion = cache.current.get(key);
      if (suggestion == null || (suggestion.pairs === 0 && nowMs - suggestion.atMs > SUGGESTION_RETRY_MS)) {
        const fresh = suggestVenueQuantity(chain, venue, costReserve, nowMs);
        if (fresh == null) continue;
        suggestion = { ...fresh, atMs: nowMs };
        cache.current.set(key, suggestion);
      }
      quantities[venue] = suggestion.quantity;
    }
    return quantities;
  }, [chain, venues, costReserve]);
}

/** Venue quoting the most options on this chain; a venue can list the asset but not this expiry. */
function busiestVenue(
  chain: EnrichedChainResponse | undefined,
  venues: readonly VenueId[],
): VenueId | null {
  let best: VenueId | null = null;
  let bestCount = 0;
  for (const venue of venues) {
    let count = 0;
    for (const strike of chain?.strikes ?? []) {
      for (const side of [strike.call, strike.put]) {
        const quote = side?.venues[venue];
        if (quote?.bid != null || quote?.ask != null) count += 1;
      }
    }
    if (count > bestCount) {
      best = venue;
      bestCount = count;
    }
  }
  return best;
}

function nearestIndex(strikes: number[], target: number): number {
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < strikes.length; i++) {
    const d = Math.abs(strikes[i]! - target);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}
