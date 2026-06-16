import { useEffect, useState } from 'react';

import { useAppStore } from '@stores/app-store';
import { Spinner, EmptyState } from '@components/ui';
import { ExpiryBar, StatStrip, ChainTable } from '@features/chain';
import { useTradfiUnderlyings, useTradfiExpiries, useTradfiChain } from './queries';
import TradfiPriceChart from './TradfiPriceChart';
import styles from './TradfiChainView.module.css';

const TRADFI_VENUES = ['tastytrade'];

type Tab = 'chain' | 'price';

export default function TradfiChainView() {
  const [tab, setTab] = useState<Tab>('chain');
  const underlying = useAppStore((s) => s.tradfiUnderlying);
  const expiry = useAppStore((s) => s.tradfiExpiry);
  const setUnderlying = useAppStore((s) => s.setTradfiUnderlying);
  const setExpiry = useAppStore((s) => s.setTradfiExpiry);

  const { data: underlyingsData } = useTradfiUnderlyings();
  const underlyings = underlyingsData?.underlyings ?? [];
  const { data: expiriesData } = useTradfiExpiries(underlying);
  const expiries = expiriesData?.expiries ?? [];
  const { data: chain, isLoading, error } = useTradfiChain(underlying, expiry);

  // Default underlying → first available.
  useEffect(() => {
    if (underlyings.length > 0 && !underlyings.includes(underlying)) {
      setUnderlying(underlyings[0]!);
    }
  }, [underlyings, underlying, setUnderlying]);

  // Default expiry → first available.
  useEffect(() => {
    if (expiries.length > 0 && !expiry) setExpiry(expiries[0]!);
  }, [expiries, expiry, setExpiry]);

  return (
    <div className={styles.view}>
      <ExpiryBar
        underlying={underlying || '—'}
        spotPrice={chain?.stats.indexPriceUsd ?? undefined}
        expiries={expiries}
        selected={expiry}
        onSelect={setExpiry}
        onChangeAsset={() => {
          const i = underlyings.indexOf(underlying);
          const next = underlyings[(i + 1) % Math.max(underlyings.length, 1)];
          if (next) setUnderlying(next);
        }}
      />

      {chain && (
        <StatStrip
          stats={chain.stats}
          underlying={chain.underlying}
          dte={chain.dte}
          marketStats={null}
          showRegimeIv={false}
        />
      )}

      <div className={styles.tabBar}>
        <button
          type="button"
          className={styles.tabBtn}
          data-active={tab === 'chain'}
          onClick={() => setTab('chain')}
        >
          Chain
        </button>
        <button
          type="button"
          className={styles.tabBtn}
          data-active={tab === 'price'}
          onClick={() => setTab('price')}
        >
          Price
        </button>
      </div>

      <div className={styles.tableArea}>
        {tab === 'chain' && (
          <>
            {isLoading && !chain && <Spinner size="lg" label="Loading TradFi chain…" />}
            {error && !chain && (
              <EmptyState
                icon="⚠"
                title="Failed to load TradFi chain"
                detail={error instanceof Error ? error.message : 'Is the TradFi service running on :3200?'}
              />
            )}
            {chain && chain.strikes.length === 0 && (
              <EmptyState icon="∅" title="No options data" detail={`No data for ${underlying} ${expiry}.`} />
            )}
            {chain && chain.strikes.length > 0 && (
              <ChainTable
                strikes={chain.strikes}
                atmStrike={chain.stats.atmStrike}
                indexPrice={chain.stats.indexPriceUsd}
                activeVenues={TRADFI_VENUES}
                myIv={null}
                expiry={expiry}
                underlying={underlying}
              />
            )}
          </>
        )}

        {tab === 'price' && (
          <TradfiPriceChart
            key={`${underlying}-${expiry}`}
            underlying={underlying}
            expiry={expiry}
            strikes={chain?.strikes.map((s) => s.strike) ?? []}
            atmStrike={chain?.stats.atmStrike ?? null}
          />
        )}
      </div>
    </div>
  );
}
