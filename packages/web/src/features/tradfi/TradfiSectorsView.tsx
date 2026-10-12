import { Spinner } from '@components/ui';
import type { TradfiSectorBasket, TradfiSectorQuote } from '@oggregator/protocol';
import { useAppStore } from '@stores/app-store';
import { type CSSProperties, useState } from 'react';

import { useTradfiSectors } from './queries';
import styles from './TradfiSectorsView.module.css';

const COLLAPSED_ROWS = 4;
// A basket mean of ±4% renders at full tint.
const FULL_TINT_MOVE = 0.04;

const ET_TIME = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: 'numeric',
  minute: '2-digit',
});
const SESSION_DATE = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});

export function formatMove(change: number | null): string {
  if (change == null) return '—';
  const pct = change * 100;
  return `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

function formatPrice(price: number | null): string {
  if (price == null) return '—';
  return price.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: price >= 1000 ? 0 : 2,
  });
}

function tone(change: number | null): 'up' | 'down' | 'flat' {
  if (change == null || change === 0) return 'flat';
  return change > 0 ? 'up' : 'down';
}

/** Leaders and laggards: keep the best and worst movers, preserving best-first order. */
export function collapsedMembers(members: TradfiSectorQuote[]): TradfiSectorQuote[] {
  const priced = members.filter((m) => m.change != null);
  if (priced.length <= COLLAPSED_ROWS) return members.slice(0, COLLAPSED_ROWS);
  const half = COLLAPSED_ROWS / 2;
  return [...priced.slice(0, half), ...priced.slice(-half)];
}

export default function TradfiSectorsView() {
  const { data, isLoading, error } = useTradfiSectors();

  if (isLoading && !data) return <Spinner size="lg" label="Loading sectors…" />;
  if (!data) {
    return <div className={styles.empty}>{error ? String(error.message) : 'No sector data yet.'}</div>;
  }

  const asOf = data.asOf != null ? `${ET_TIME.format(data.asOf)} ET` : '—';
  const vs = data.prevCloseDate
    ? SESSION_DATE.format(new Date(`${data.prevCloseDate}T12:00:00Z`))
    : 'previous';

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <h1 className={styles.title}>Sector Dive</h1>
        <p className={styles.subtitle}>
          TastyTrade tape <span className={styles.sep}>|</span> {data.baskets.length} baskets{' '}
          <span className={styles.sep}>|</span> {asOf}
        </p>
        <p className={styles.note}>
          15-min delayed. Moves vs {vs} regular-session close. Sorted by basket average; tag = rank,
          breadth, median.
        </p>
      </header>

      <div className={styles.tape}>
        {data.tape.map((q) => (
          <span key={q.symbol} className={styles.tapeItem}>
            <span className={styles.tapeLabel}>{q.label}</span>
            <span>{formatPrice(q.last)}</span>
            <span data-tone={tone(q.change)}>{formatMove(q.change)}</span>
          </span>
        ))}
      </div>

      <div className={styles.grid}>
        {data.baskets.map((b) => (
          <BasketTile key={b.id} basket={b} />
        ))}
      </div>
    </div>
  );
}

function BasketTile({ basket }: { basket: TradfiSectorBasket }) {
  const [expanded, setExpanded] = useState(false);
  const setUnderlying = useAppStore((s) => s.setTradfiUnderlying);
  const setPage = useAppStore((s) => s.setTradfiPage);

  const rows = expanded ? basket.members : collapsedMembers(basket.members);
  const hidden = basket.members.length - rows.length;
  const tint = basket.mean == null ? 0 : Math.min(Math.abs(basket.mean) / FULL_TINT_MOVE, 1);
  const tileTone = tone(basket.mean);

  const open = (symbol: string) => {
    setUnderlying(symbol);
    setPage('chain');
  };

  return (
    <section
      className={styles.tile}
      data-bias={tileTone}
      style={{ '--tint': `${Math.round(8 + tint * 30)}%` } as CSSProperties}
      aria-label={`${basket.name} ${formatMove(basket.mean)}`}
    >
      <div className={styles.tileHead}>
        <h2 className={styles.tileName}>{basket.name}</h2>
        <span className={styles.tileMove} data-tone={tileTone}>
          {formatMove(basket.mean)}
        </span>
      </div>
      <div className={styles.tileMeta}>
        {basket.rank != null ? `#${basket.rank}` : '#—'} {basket.green}/{basket.priced} green · med{' '}
        {formatMove(basket.median)}
      </div>
      <ul className={styles.rows}>
        {rows.map((m) => (
          <li key={m.symbol} className={styles.row}>
            {m.hasOptions ? (
              <button
                type="button"
                className={styles.symbolLink}
                onClick={() => open(m.symbol)}
                title={`Open ${m.symbol} chain`}
              >
                {m.symbol}
              </button>
            ) : (
              <span className={styles.symbol}>{m.symbol}</span>
            )}
            <span className={styles.price}>{formatPrice(m.last)}</span>
            <span className={styles.move} data-tone={tone(m.change)}>
              {formatMove(m.change)}
            </span>
          </li>
        ))}
      </ul>
      {(hidden > 0 || expanded) && basket.members.length > COLLAPSED_ROWS && (
        <button type="button" className={styles.more} onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'less ▴' : `+${hidden} more ▾`}
        </button>
      )}
    </section>
  );
}
