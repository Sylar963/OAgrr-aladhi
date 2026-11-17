import { defineMessages, useT } from '@lib/i18n';
import { VENUE_LIST } from '@lib/venue-meta';
import styles from './QuoteSourcePicker.module.css';

const messages = defineMessages(
  {
    sources: 'Quote sources',
    source: 'Use {venue} quotes',
    hint: 'Select the venues used for Easy Mode bid/ask prices, break-even and tolls. Feed subscriptions and existing legs keep their current settings.',
    all: 'All',
    none: 'None',
    allSources: 'Use all available quote sources',
    noSources: 'Clear quote sources',
    basis: 'Bid/ask · break-even · toll',
    empty: 'Select a quote source to price options.',
  },
  {
    sources: 'Fuentes de cotización',
    source: 'Usar cotizaciones de {venue}',
    hint: 'Elige los venues para los precios bid/ask, breakeven y peajes del modo fácil. Las suscripciones y las patas existentes conservan sus ajustes.',
    all: 'Todos',
    none: 'Ninguno',
    allSources: 'Usar todas las fuentes disponibles',
    noSources: 'Limpiar fuentes de cotización',
    basis: 'Bid/ask · breakeven · peaje',
    empty: 'Elige una fuente para calcular los precios.',
  },
);

interface QuoteSourcePickerProps {
  availableVenues: string[];
  quoteVenues: string[];
  onToggle: (venue: string) => void;
  onAll: () => void;
  onNone: () => void;
}

export default function QuoteSourcePicker({
  availableVenues,
  quoteVenues,
  onToggle,
  onAll,
  onNone,
}: QuoteSourcePickerProps) {
  const t = useT(messages);
  return (
    <div className={styles.control}>
      <div className={styles.picker} role="group" aria-label={t('sources')} title={t('hint')}>
        <span className={styles.label}>{t('sources')}</span>
        <div className={styles.venues}>
          {VENUE_LIST.filter((venue) => availableVenues.includes(venue.id)).map((venue) => {
            const selected = quoteVenues.includes(venue.id);
            return (
              <button
                key={venue.id}
                type="button"
                className={styles.venue}
                aria-label={t('source', { venue: venue.label })}
                aria-pressed={selected}
                title={venue.label}
                onClick={() => onToggle(venue.id)}
              >
                <img src={venue.logo} alt="" />
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className={styles.action}
          onClick={onAll}
          aria-label={t('allSources')}
        >
          {t('all')}
        </button>
        <button
          type="button"
          className={styles.action}
          onClick={onNone}
          aria-label={t('noSources')}
        >
          {t('none')}
        </button>
      </div>
      <span className={styles.basis} data-empty={quoteVenues.length === 0}>
        {t(quoteVenues.length === 0 ? 'empty' : 'basis')}
      </span>
    </div>
  );
}
