import { useQuery } from '@tanstack/react-query';
import { PRIVATE_ADAPTER_SPECS, type VenueId } from '@oggregator/protocol';
import { useAppStore } from '@stores/app-store';
import { VENUES } from '@lib/venue-meta';
import { fetchMetrics, venueStatus } from './api';
import styles from './AlphaPortfolioContext.module.css';

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

export default function AlphaPortfolioContext({
  venue,
  underlying,
}: {
  venue: VenueId;
  underlying: string;
}) {
  const navigate = useAppStore((s) => s.setActiveTab);
  const supported = PRIVATE_ADAPTER_SPECS[venue].status === 'available';
  const status = useQuery({
    queryKey: ['alpha-portfolio-status', venue],
    queryFn: () => venueStatus(venue),
    enabled: supported,
    retry: false,
    refetchInterval: 15_000,
  });
  const connected = status.data?.connected === true && !status.isError;
  const portfolio = useQuery({
    queryKey: ['portfolio', 'metrics', 0, venue, underlying],
    queryFn: () => fetchMetrics(0, venue, underlying),
    enabled: connected,
    retry: false,
    refetchInterval: 5_000,
  });
  const metrics = connected && !portfolio.isError ? portfolio.data?.metrics : null;
  const positions = connected && !portfolio.isError ? (portfolio.data?.positions ?? []) : [];
  const stale = metrics != null && Date.now() - metrics.generatedAt > 30_000;
  function openPortfolio() {
    try {
      localStorage.setItem('portfolioSource', venue);
      localStorage.setItem('portfolioUnderlying', underlying);
    } catch {}
    navigate('portfolio');
  }
  return (
    <section className={styles.wrap} aria-label="Existing portfolio exposure">
      <div className={styles.heading}>
        <span>Already in your book · {VENUES[venue]?.label ?? venue}</span>
        <button type="button" onClick={openPortfolio}>
          Open Portfolio →
        </button>
      </div>
      {!connected || portfolio.isError || metrics == null ? (
        <p>
          {portfolio.isError || status.isError
            ? 'Portfolio unavailable. Open Portfolio to check the connection.'
            : connected
              ? 'Loading portfolio exposure…'
              : 'Connect this venue in Portfolio to see existing exposure here.'}{' '}
          Account equity and free margin are not supplied to this scanner.
        </p>
      ) : (
        <>
          <div className={styles.stats}>
            <span>{positions.length} open legs</span>
            <span>Open P&L {money(metrics.totals.unrealizedPnlUsd)}</span>
            <span>Theta {money(metrics.totals.netThetaUsd)} / day</span>
            <span>
              {stale
                ? 'Stale portfolio snapshot'
                : 'Updated ' + new Date(metrics.generatedAt).toLocaleTimeString()}
            </span>
          </div>
          {metrics.byExpiry.map((bucket) => (
            <div className={styles.row} key={bucket.expiry}>
              <strong>{bucket.expiry}</strong>
              <span>{bucket.dte.toFixed(1)} days</span>
              <span>{positions.filter((p) => p.expiry === bucket.expiry).length} legs</span>
              <span>Theta {money(bucket.theta)} / day</span>
            </div>
          ))}
          <p>
            New trades add to this exposure. Scanner risk is per trade; it does not approve
            portfolio margin. Different expiries settle at different prices.
          </p>
        </>
      )}
    </section>
  );
}
