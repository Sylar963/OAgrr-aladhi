import { useEffect, useRef } from "react";

import { useAppStore } from "@stores/app-store";
import { useChainQuery, useExpiries } from "./queries";
import { useChainWs } from "@hooks/useChainWs";
import { useOpenPalette } from "@components/layout";

import ExpiryBar    from "./ExpiryBar";
import StatStrip    from "./StatStrip";
import NewChainTable from "./NewChainTable";
import VenueSidebar from "./VenueSidebar";
import MyIvInput    from "./MyIvInput";
import styles       from "./ChainView.module.css";

export default function ChainView() {
  const underlying  = useAppStore((s) => s.underlying);
  const expiry      = useAppStore((s) => s.expiry);
  const setExpiry   = useAppStore((s) => s.setExpiry);
  const activeVenues = useAppStore((s) => s.activeVenues);
  const toggleVenue = useAppStore((s) => s.toggleVenue);
  const setActiveVenues = useAppStore((s) => s.setActiveVenues);
  const myIv        = useAppStore((s) => s.myIv);
  const openPalette = useOpenPalette();

  const { data: expiriesData } = useExpiries(underlying);
  const expiries = expiriesData?.expiries ?? [];
  const expiryByVenue = expiriesData?.byVenue;

  const { data: chain, isLoading, error } = useChainQuery(underlying, expiry, activeVenues);
  const setFeedStatus = useAppStore((s) => s.setFeedStatus);
  const { connectionState, staleMs, failedVenues } = useChainWs({ underlying, expiry, venues: activeVenues });

  useEffect(() => {
    setFeedStatus({ connectionState, failedVenueCount: failedVenues.length, staleMs });
  }, [connectionState, failedVenues.length, staleMs, setFeedStatus]);

  useEffect(() => {
    if (expiries.length > 0 && !expiry) {
      setExpiry(expiries[0]!);
    }
  }, [expiries, expiry, setExpiry]);

  // Only auto-reset venue selection when the underlying changes — not on every
  // expiry switch. Without this guard, manually toggling a venue off and then
  // navigating to a different expiry overwrites the user's selection.
  const lastAutoSetUnderlyingRef = useRef<string | null>(null);
  useEffect(() => {
    if (!expiryByVenue || underlying === lastAutoSetUnderlyingRef.current) return;
    const available = expiryByVenue.map((v) => v.venue);
    if (available.length > 0) {
      lastAutoSetUnderlyingRef.current = underlying;
      setActiveVenues(available);
    }
  }, [underlying, expiryByVenue, setActiveVenues]);

  const myIvFloat = myIv !== "" ? parseFloat(myIv) / 100 : null;
  const myIvValid = myIvFloat != null && !isNaN(myIvFloat) && myIvFloat > 0;

  return (
    <div className={styles.view}>
      <VenueSidebar
        activeVenues={activeVenues}
        onToggle={toggleVenue}
        failedVenues={failedVenues}
      />

      <div className={styles.main}>
        <ExpiryBar
          underlying={underlying}
          spotPrice={chain?.stats.spotIndexUsd}
          expiries={expiries}
          selected={expiry}
          onSelect={setExpiry}
          onChangeAsset={openPalette}
        />

        {chain && (
          <StatStrip
            stats={chain.stats}
            underlying={chain.underlying}
            dte={chain.dte}
            connectionState={connectionState}
          />
        )}

        <div className={styles.tableControls}>
          <MyIvInput />
        </div>

        <div className={styles.tableArea}>
          {isLoading && !chain && (
            <div className={styles.status}>Loading chain data…</div>
          )}
          {error && (
            <div className={styles.error}>
              {error instanceof Error ? error.message : "Failed to load chain"}
            </div>
          )}
          {chain && (
            <NewChainTable
              strikes={chain.strikes}
              atmStrike={chain.stats.atmStrike}
              forwardPrice={chain.stats.forwardPriceUsd}
              activeVenues={activeVenues}
              myIv={myIvValid ? myIvFloat : null}
            />
          )}
        </div>
      </div>
    </div>
  );
}
