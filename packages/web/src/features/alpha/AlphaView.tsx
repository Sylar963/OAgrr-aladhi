import { useEffect, useMemo, useState } from 'react';

import { useAppStore } from '@stores/app-store';
import { useChainQuery, useExpiries } from '@features/chain/queries';
import { useChainWs } from '@hooks/useChainWs';
import { useOpenPalette } from '@components/layout';
import { Spinner, EmptyState } from '@components/ui';
import ExpiryBar from '@features/chain/ExpiryBar';
import type { SpreadKind } from '@lib/analytics/verticalSpread';

import SpreadBuilderPanel from './SpreadBuilderPanel';
import SignalCard from './SignalCard';
import VenueRouterTable from './VenueRouterTable';
import VolSmileInset from './VolSmileInset';
import { useVerticalSpreadAnalysis } from './useVerticalSpreadAnalysis';
import styles from './AlphaView.module.css';

export default function AlphaView() {
  const underlying = useAppStore((s) => s.underlying);
  const expiry = useAppStore((s) => s.expiry);
  const setExpiry = useAppStore((s) => s.setExpiry);
  const activeVenues = useAppStore((s) => s.activeVenues);
  const setFeedStatus = useAppStore((s) => s.setFeedStatus);
  const openPalette = useOpenPalette();

  const { data: expiriesData } = useExpiries(underlying);
  const expiries = expiriesData?.expiries ?? [];
  const { data: chain, isLoading, error } = useChainQuery(underlying, expiry, activeVenues);
  const { connectionState, staleMs, failedVenues } = useChainWs({
    underlying,
    expiry,
    venues: activeVenues,
  });

  useEffect(() => {
    const failedVenueIds = failedVenues.map((f) => f.venue);
    setFeedStatus({
      connectionState,
      failedVenueCount: failedVenues.length,
      failedVenueIds,
      staleMs,
      lastUpdateMs: connectionState === 'live' && staleMs != null ? Date.now() - staleMs : null,
    });
  }, [connectionState, failedVenues, staleMs, setFeedStatus]);

  useEffect(() => {
    if (expiries.length > 0 && !expiry) setExpiry(expiries[0]!);
  }, [expiries, expiry, setExpiry]);

  const [kind, setKind] = useState<SpreadKind>('call-credit');
  const [shortStrike, setShortStrike] = useState<number | null>(null);
  const [longStrike, setLongStrike] = useState<number | null>(null);

  // Reset leg selection when the underlying or expiry changes — old strikes
  // may not exist on the new chain.
  useEffect(() => {
    setShortStrike(null);
    setLongStrike(null);
  }, [underlying, expiry]);

  const atmStrike = chain?.stats.atmStrike ?? null;

  // Seed reasonable defaults once the chain arrives: for call-credit, short
  // ≈ ATM, long ≈ first strike above that. For put-credit, mirror image.
  useEffect(() => {
    if (!chain || shortStrike != null || longStrike != null) return;
    const strikes = [...chain.strikes].map((s) => s.strike).sort((a, b) => a - b);
    if (strikes.length < 2 || atmStrike == null) return;
    const atmIdx = nearestIndex(strikes, atmStrike);
    if (kind === 'call-credit') {
      const shortIdx = Math.min(atmIdx + 1, strikes.length - 2);
      setShortStrike(strikes[shortIdx]!);
      setLongStrike(strikes[shortIdx + 1]!);
    } else {
      const shortIdx = Math.max(atmIdx - 1, 1);
      setShortStrike(strikes[shortIdx]!);
      setLongStrike(strikes[shortIdx - 1]!);
    }
  }, [chain, atmStrike, kind, shortStrike, longStrike]);

  const analysis = useVerticalSpreadAnalysis({
    chain,
    kind,
    shortStrike,
    longStrike,
    venues: activeVenues,
  });

  const executableNet = useMemo(() => {
    const sn = analysis.analysis?.short.best?.netAfterFees;
    const ln = analysis.analysis?.long.best?.netAfterFees;
    if (sn == null || ln == null) return null;
    return sn - ln;
  }, [analysis]);

  if (isLoading && !chain) {
    return (
      <div className={styles.view}>
        <Spinner size="lg" label="Loading chain data…" />
      </div>
    );
  }

  if (error && !chain) {
    return (
      <div className={styles.view}>
        <EmptyState
          icon="⚠"
          title="Failed to load chain"
          detail={error instanceof Error ? error.message : 'Check your connection and try again.'}
        />
      </div>
    );
  }

  return (
    <div className={styles.view}>
      <ExpiryBar
        underlying={underlying}
        spotPrice={chain?.stats.spotIndexUsd}
        expiries={expiries}
        selected={expiry}
        onSelect={setExpiry}
        onChangeAsset={openPalette}
      />

      {chain && chain.strikes.length === 0 && (
        <EmptyState
          icon="∅"
          title="No options data"
          detail={`No venues returned data for ${underlying} ${expiry}.`}
        />
      )}

      {chain && chain.strikes.length > 0 && (
        <div className={styles.grid}>
          <SpreadBuilderPanel
            kind={kind}
            onKindChange={(k) => {
              setKind(k);
              setShortStrike(null);
              setLongStrike(null);
            }}
            strikes={chain.strikes}
            atmStrike={atmStrike}
            shortStrike={shortStrike}
            longStrike={longStrike}
            onShortChange={setShortStrike}
            onLongChange={setLongStrike}
            riskFreeRate={analysis.r}
            T={analysis.T}
          />

          <div className={styles.rightColumn}>
            <SignalCard signal={analysis.analysis?.combinedSignal ?? null} />

            <VenueRouterTable
              shortLeg={analysis.analysis?.short ?? null}
              longLeg={analysis.analysis?.long ?? null}
              shortStrike={shortStrike}
              longStrike={longStrike}
              executableNetCredit={executableNet}
            />

            <VolSmileInset
              smile={analysis.smile}
              shortStrike={shortStrike}
              longStrike={longStrike}
            />
          </div>
        </div>
      )}
    </div>
  );
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
