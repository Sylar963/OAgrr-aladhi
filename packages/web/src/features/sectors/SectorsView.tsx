import { Spinner } from '@components/ui';
import { defineMessages, useT } from '@lib/i18n';
import type { CryptoSectorBasket, CryptoSectorQuote } from '@oggregator/protocol';
import { useAppStore } from '@stores/app-store';
import { type CSSProperties, useState } from 'react';

import { useCryptoSectors } from './queries';
import styles from './SectorsView.module.css';

const messages = defineMessages(
  {
    loading: 'Loading sectors…',
    noData: 'No sector data yet.',
    title: 'Sectors',
    perps: 'Bybit perps',
    baskets: '{n} baskets',
    note: 'Rolling 24h move. Sorted by basket average; tag = rank, breadth, median. Right column = options venues listing the asset (of {n}).',
    meta: '{rank} {green}/{priced} green · med {median}',
    openChain: 'Open {symbol} chain',
    optionsOn: 'Options on {venues}',
    noOptions: 'No options venue',
    less: 'less ▴',
    more: '+{n} more ▾',
  },
  {
    loading: 'Cargando sectores…',
    noData: 'Aún no hay datos de sectores.',
    title: 'Sectores',
    perps: 'Perps de Bybit',
    baskets: '{n} canastas',
    note: 'Movimiento móvil de 24h. Ordenado por promedio de la canasta; etiqueta = posición, amplitud, mediana. Columna derecha = exchanges de opciones que listan el activo (de {n}).',
    meta: '{rank} {green}/{priced} en verde · med {median}',
    openChain: 'Abrir cadena de {symbol}',
    optionsOn: 'Opciones en {venues}',
    noOptions: 'Sin exchange de opciones',
    less: 'menos ▴',
    more: '+{n} más ▾',
  },
);

const COLLAPSED_ROWS = 4;
// Crypto baskets swing harder than equity ones; a ±8% mean renders at full tint.
const FULL_TINT_MOVE = 0.08;

const TIME = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function formatMove(change: number | null): string {
  if (change == null) return '—';
  const pct = change * 100;
  return `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

export function formatPrice(price: number | null): string {
  if (price == null) return '—';
  if (price >= 1000) return price.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (price >= 1) {
    return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return price.toLocaleString('en-US', { maximumSignificantDigits: 4 });
}

function tone(change: number | null): 'up' | 'down' | 'flat' {
  if (change == null || change === 0) return 'flat';
  return change > 0 ? 'up' : 'down';
}

/** Leaders and laggards: keep the best and worst movers, preserving best-first order. */
export function collapsedMembers(members: CryptoSectorQuote[]): CryptoSectorQuote[] {
  const priced = members.filter((m) => m.change != null);
  if (priced.length <= COLLAPSED_ROWS) return members.slice(0, COLLAPSED_ROWS);
  const half = COLLAPSED_ROWS / 2;
  return [...priced.slice(0, half), ...priced.slice(-half)];
}

export default function SectorsView() {
  const t = useT(messages);
  const { data, isLoading, error } = useCryptoSectors();

  if (isLoading && !data) return <Spinner size="lg" label={t('loading')} />;
  if (!data) {
    return (
      <div className={styles.empty}>{error ? String(error.message) : t('noData')}</div>
    );
  }

  const asOf = data.asOf != null ? `${TIME.format(data.asOf)} UTC` : '—';

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t('title')}</h1>
        <p className={styles.subtitle}>
          {t('perps')} <span className={styles.sep}>|</span> {t('baskets', { n: data.baskets.length })}{' '}
          <span className={styles.sep}>|</span> {asOf}
        </p>
        <p className={styles.note}>
          {t('note', { n: data.venueCount })}
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
          <BasketTile key={b.id} basket={b} venueCount={data.venueCount} />
        ))}
      </div>
    </div>
  );
}

function BasketTile({ basket, venueCount }: { basket: CryptoSectorBasket; venueCount: number }) {
  const t = useT(messages);
  const [expanded, setExpanded] = useState(false);
  const setUnderlying = useAppStore((s) => s.setUnderlying);
  const setActiveTab = useAppStore((s) => s.setActiveTab);

  const rows = expanded ? basket.members : collapsedMembers(basket.members);
  const hidden = basket.members.length - rows.length;
  const tint = basket.mean == null ? 0 : Math.min(Math.abs(basket.mean) / FULL_TINT_MOVE, 1);
  const tileTone = tone(basket.mean);

  const open = (symbol: string) => {
    setUnderlying(symbol);
    setActiveTab('chain');
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
        {t('meta', {
          rank: basket.rank != null ? `#${basket.rank}` : '#—',
          green: basket.green,
          priced: basket.priced,
          median: formatMove(basket.median),
        })}
      </div>
      <ul className={styles.rows}>
        {rows.map((m) => (
          <li key={m.symbol} className={styles.row}>
            {m.optionVenues.length > 0 ? (
              <button
                type="button"
                className={styles.symbolLink}
                onClick={() => open(m.symbol)}
                title={t('openChain', { symbol: m.symbol })}
              >
                {m.label}
              </button>
            ) : (
              <span className={styles.symbol}>{m.label}</span>
            )}
            <span className={styles.price}>{formatPrice(m.last)}</span>
            <span
              className={styles.venues}
              title={
                m.optionVenues.length > 0
                  ? t('optionsOn', { venues: m.optionVenues.join(', ') })
                  : t('noOptions')
              }
            >
              {m.optionVenues.length > 0 ? `${m.optionVenues.length}/${venueCount}` : ''}
            </span>
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
