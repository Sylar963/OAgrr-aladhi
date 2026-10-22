import { Spinner } from '@components/ui';
import { defineMessages, intlLocale, useLocale, useT } from '@lib/i18n';
import type { TradfiSectorBasket, TradfiSectorQuote } from '@oggregator/protocol';
import { useAppStore } from '@stores/app-store';
import { type CSSProperties, useMemo, useState } from 'react';

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
const SESSION_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  timeZone: 'UTC',
  weekday: 'short',
  month: 'short',
  day: 'numeric',
};

const messages = defineMessages(
  {
    loading: 'Loading sectors…',
    noData: 'No sector data yet.',
    title: 'Sectors',
    tape: 'TastyTrade tape',
    baskets: '{n} baskets',
    note: '15-min delayed. Moves vs {vs} regular-session close. Sorted by basket average; tag = rank, breadth, median.',
    notePrevious:
      '15-min delayed. Moves vs previous regular-session close. Sorted by basket average; tag = rank, breadth, median.',
    greenMedian: '{green}/{priced} green · med',
    openChain: 'Open {symbol} chain',
    less: 'less ▴',
    more: '+{n} more ▾',
  },
  {
    loading: 'Cargando sectores…',
    noData: 'Aún no hay datos de sectores.',
    title: 'Sectores',
    tape: 'Cinta de TastyTrade',
    baskets: '{n} canastas',
    note: 'Retraso de 15 min. Movimientos vs el cierre de sesión regular del {vs}. Ordenado por promedio de canasta; etiqueta = ranking, amplitud, mediana.',
    notePrevious:
      'Retraso de 15 min. Movimientos vs el cierre de sesión regular anterior. Ordenado por promedio de canasta; etiqueta = ranking, amplitud, mediana.',
    greenMedian: '{green}/{priced} en verde · med',
    openChain: 'Abrir cadena de {symbol}',
    less: 'menos ▴',
    more: '+{n} más ▾',
  },
);

export function formatMove(change: number | null): string {
  if (change == null) return '—';
  const pct = change * 100;
  return `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

function formatPrice(price: number | null): string {
  if (price == null) return '—';
  const digits = price >= 1000 ? 0 : 2;
  return price.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
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
  const t = useT(messages);
  const locale = useLocale();
  const sessionDate = useMemo(
    () => new Intl.DateTimeFormat(intlLocale(locale), SESSION_DATE_OPTIONS),
    [locale],
  );
  const { data, isLoading, error } = useTradfiSectors();

  if (isLoading && !data) return <Spinner size="lg" label={t('loading')} />;
  if (!data) {
    return <div className={styles.empty}>{error ? String(error.message) : t('noData')}</div>;
  }

  const asOf = data.asOf != null ? `${ET_TIME.format(data.asOf)} ET` : '—';
  const note = data.prevCloseDate
    ? t('note', { vs: sessionDate.format(new Date(`${data.prevCloseDate}T12:00:00Z`)) })
    : t('notePrevious');

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t('title')}</h1>
        <p className={styles.subtitle}>
          {t('tape')} <span className={styles.sep}>|</span>{' '}
          {t('baskets', { n: data.baskets.length })}{' '}
          <span className={styles.sep}>|</span> {asOf}
        </p>
        <p className={styles.note}>{note}</p>
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
  const t = useT(messages);
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
        {basket.rank != null ? `#${basket.rank}` : '#—'}{' '}
        {t('greenMedian', { green: basket.green, priced: basket.priced })}{' '}
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
                title={t('openChain', { symbol: m.symbol })}
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
          {expanded ? t('less') : t('more', { n: hidden })}
        </button>
      )}
    </section>
  );
}
