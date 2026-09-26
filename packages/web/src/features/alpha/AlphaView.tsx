import { useOpenPalette } from '@components/layout/palette-context';
import { EmptyState, Spinner } from '@components/ui';
import { ExpiryBar, useChainQuery, useExpiries, usePrefetchChain } from '@features/chain';
import { AlphaPortfolioContext } from '@features/portfolio';
import { useIsMobile } from '@hooks/useIsMobile';
import type { SpreadKind } from '@lib/analytics/verticalSpread';
import { VENUE_IDS } from '@oggregator/protocol';
import type { VenueId } from '@shared/enriched';
import { useAppStore } from '@stores/app-store';
import { useEffect, useMemo, useState } from 'react';
import AlphaContextStrip from './AlphaContextStrip';
import AlphaTradeSizing, { useAlphaSizing } from './AlphaTradeSizing';
import AlphaVenueOpportunities from './AlphaVenueOpportunities';
import styles from './AlphaView.module.css';
import LottoScannerPanel from './LottoScannerPanel';
import CrossVenueOpportunities from './CrossVenueOpportunities';
import {
  type CrossVenueCandidate,
  type CrossVenueScan,
  scanCrossVenueSpreads,
} from './cross-venue-scanner';
import SignalCard, { type ExecutionRoute } from './SignalCard';
import SpreadBuilderPanel from './SpreadBuilderPanel';
import StraddleScannerPanel from './StraddleScannerPanel';
import { type SpreadCandidate, scanSpreads, type VenueScan } from './spread-scanner';
import { computeSviRichness } from './sviRichness';
import { useAlphaMarketContext } from './useAlphaMarketContext';
import { useRegimeQuery } from './useRegimeQuery';
import { useVerticalSpreadAnalysis } from './useVerticalSpreadAnalysis';
import type { VerticalEconomics } from './vertical-pricing';
import VolSmileInset from './VolSmileInset';

type AlphaStrategy = SpreadKind | 'long-call' | 'short-straddle';

const STRATEGIES: ReadonlyArray<{ id: AlphaStrategy; label: string }> = [
  { id: 'call-credit', label: 'Call Credit' },
  { id: 'put-credit', label: 'Put Credit' },
  { id: 'call-debit', label: 'Call Debit' },
  { id: 'put-debit', label: 'Put Debit' },
  { id: 'long-call', label: 'Long Call' },
  { id: 'short-straddle', label: 'Sell Straddle' },
];

export default function AlphaView() {
  const underlying = useAppStore((s) => s.underlying);
  const expiry = useAppStore((s) => s.expiry);
  const setExpiry = useAppStore((s) => s.setExpiry);
  const activeVenues = useAppStore((s) => s.activeVenues);
  const scanVenues = useMemo(
    () => VENUE_IDS.filter((venue) => activeVenues.includes(venue)),
    [activeVenues],
  );
  const openPalette = useOpenPalette();

  const { data: expiriesData } = useExpiries(underlying);
  const expiries = expiriesData?.expiries ?? [];
  const prefetchChain = usePrefetchChain(underlying, activeVenues);
  const { data: chain, isLoading, error } = useChainQuery(underlying, expiry, activeVenues);

  const isMobile = useIsMobile();
  const [strategy, setStrategy] = useState<AlphaStrategy>('call-credit');
  const isSpread = strategy !== 'long-call' && strategy !== 'short-straddle';
  const kind: SpreadKind = isSpread ? strategy : 'call-credit';
  const [shortStrike, setShortStrike] = useState<number | null>(null);
  const [longStrike, setLongStrike] = useState<number | null>(null);
  const [preferredVenue, setPreferredVenue] = useState<VenueId>('thalex');
  const [preferredBuyVenue, setPreferredBuyVenue] = useState<VenueId | null>(null);
  const tradeVenue = scanVenues.includes(preferredVenue)
    ? preferredVenue
    : (scanVenues[0] ?? 'thalex');
  const { sizing, update } = useAlphaSizing();
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
  const scans = useMemo(() => (scanInput ? scanSpreads(scanInput) : []), [scanInput]);
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

  const { data: regime } = useRegimeQuery(underlying);
  const marketContext = useAlphaMarketContext(underlying);
  const regimeDominant = regime?.dominant ?? null;

  const analysis = useVerticalSpreadAnalysis({
    chain,
    kind,
    shortStrike,
    longStrike,
    venues: activeVenues,
    regimeDominant,
  });

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
        riskBudgetPct={Number(sizing.riskPct)}
        emptyState={!sizing.equity.trim() ? 'equity' : error ? 'market' : 'quote'}
        emptyReason={
          !sizing.equity.trim()
            ? 'Enter your current account equity in the builder to see dollar risk at your size.'
            : error
              ? 'Chain unavailable. Cached quotes are not used for a trade estimate.'
              : 'No eligible quote for these strikes, venue, and size. Check sizing, expiry, quote exclusions, or load an alternative below.'
        }
        regime={regime ?? null}
      />
      <AlphaVenueOpportunities
        scans={scans}
        kind={kind}
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
      <details>
        <summary>Existing portfolio risk · {tradeVenue}</summary>
        <AlphaPortfolioContext venue={tradeVenue} underlying={underlying} />
      </details>
    </>
  );

  return (
    <div className={styles.view}>
      <div className={styles.strategyBar}>
        <button type="button" className={styles.assetButton} onClick={openPalette}>
          <span>ALPHA</span>
          <strong>{underlying}</strong>
        </button>
        <div className={styles.strategyTabs} role="tablist" aria-label="Alpha strategy">
          {STRATEGIES.map((item) => (
            <button
              type="button"
              role="tab"
              aria-selected={strategy === item.id}
              data-active={strategy === item.id}
              key={item.id}
              onClick={() => {
                if (item.id === strategy) return;
                if (item.id === 'long-call' || item.id === 'short-straddle') {
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
              {item.label}
            </button>
          ))}
        </div>
        <span className={styles.venueScope}>{activeVenues.length} ACTIVE VENUES</span>
      </div>

      {!isMobile && isSpread && (
        <ExpiryBar
          underlying={underlying}
          spotPrice={chain?.stats.forwardPriceUsd}
          expiries={expiries}
          selected={expiry}
          onSelect={setExpiry}
          onChangeAsset={openPalette}
          onPrefetch={prefetchChain}
        />
      )}

      <AlphaContextStrip
        context={marketContext.data ?? null}
        strategy={strategy}
        loading={marketContext.isLoading}
      />

      {strategy === 'long-call' && (
        <div className={styles.scannerWorkspace}>
          <LottoScannerPanel underlying={underlying} venues={activeVenues} />
        </div>
      )}

      {strategy === 'short-straddle' && (
        <div className={styles.scannerWorkspace}>
          <StraddleScannerPanel underlying={underlying} venues={activeVenues} />
        </div>
      )}

      {isSpread && isLoading && !chain && (
        <div className={styles.state}>
          <Spinner size="lg" label="Loading chain data…" />
        </div>
      )}

      {isSpread && error && !chain && (
        <div className={styles.state}>
          <EmptyState
            icon="⚠"
            title="Failed to load chain"
            detail={error instanceof Error ? error.message : 'Check your connection and try again.'}
          />
        </div>
      )}

      {isSpread && chain && chain.strikes.length === 0 && (
        <EmptyState
          icon="∅"
          title="No options data"
          detail={`No venues returned data for ${underlying} ${expiry}.`}
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
