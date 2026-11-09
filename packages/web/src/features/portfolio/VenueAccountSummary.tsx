import { useAccountSession } from '@components/auth/AccountSessionProvider';
import { useEffect, useState, type ReactNode } from 'react';
import { defineMessages, useT } from '@lib/i18n';
import styles from './VenueAccountSummary.module.css';

const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const messages = defineMessages(
  {
    title: '{venue} account · all assets',
    equity: 'Equity',
    free: 'Free collateral',
    freeMargin: 'Free margin',
    mainnet: 'Mainnet',
    testnet: 'Testnet',
    maintenanceMissing: 'Maintenance margin is not reported by Thalex.',
    unpriced: 'Equity excludes assets without a price: {assets}.',
    initial: 'Initial margin',
    maintenance: 'Maintenance margin',
    connect: 'Connect {venue} in Portfolio to see current equity.',
    loading: 'Loading {venue} equity…',
    unavailable: '{venue} equity unavailable. Check your read-only connection.',
    stale: 'Stale equity · fetched {time}',
    fetched: 'Fetched {time}',
    useEquity: 'Use equity for this plan',
    unit: 'Values in {asset}; displayed at 1:1 USD.',
  },
  {
    title: 'Cuenta {venue} · todos los activos',
    equity: 'Capital',
    free: 'Colateral libre',
    freeMargin: 'Margen libre',
    mainnet: 'Mainnet',
    testnet: 'Testnet',
    maintenanceMissing: 'Thalex no informa el margen de mantenimiento.',
    unpriced: 'El capital excluye activos sin precio: {assets}.',
    initial: 'Margen inicial',
    maintenance: 'Margen de mantenimiento',
    connect: 'Conecta {venue} en Portafolio para ver el capital actual.',
    loading: 'Cargando capital de {venue}…',
    unavailable: 'Capital de {venue} no disponible. Revisa tu conexión de solo lectura.',
    stale: 'Capital desactualizado · consultado {time}',
    fetched: 'Consultado {time}',
    useEquity: 'Usar capital para este plan',
    unit: 'Valores en {asset}; mostrados a 1:1 USD.',
  },
);

export interface VenueAccountSummaryProps {
  venue: 'Paradex' | 'Thalex';
  data?: {
    equityUsd: number;
    freeCollateralUsd: number | null;
    initialMarginUsd: number | null;
    maintenanceMarginUsd: number | null;
    settlementAsset?: string | null;
    fetchedAt: number;
    environment?: 'prod' | 'test';
    unpricedAssets?: string[];
  };
  isError: boolean;
  isPending: boolean;
  onUseEquity?: (equity: number) => void;
  accountSelector?: ReactNode;
}

export default function VenueAccountSummary({
  venue,
  data,
  isError,
  isPending,
  onUseEquity,
  accountSelector,
}: VenueAccountSummaryProps) {
  const t = useT(messages);
  const session = useAccountSession();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(timer);
  }, []);
  const fresh =
    data != null && session.status === 'ready' && !isError && now - data.fetchedAt < 30_000;
  return (
    <section className={styles.account} aria-label={t('title', { venue })}>
      <header>
        {accountSelector ?? <strong>{t('title', { venue })}</strong>}
        {data?.environment && (
          <span className={styles.network} data-network={data.environment}>
            {t(data.environment === 'test' ? 'testnet' : 'mainnet')}
          </span>
        )}
        {data && (
          <small data-stale={!fresh}>
            {t(fresh ? 'fetched' : 'stale', {
              time: new Date(data.fetchedAt).toLocaleTimeString(),
            })}
          </small>
        )}
      </header>
      {data ? (
        <>
          <dl>
            {(
              [
                ['equity', data.equityUsd],
                [venue === 'Thalex' ? 'freeMargin' : 'free', data.freeCollateralUsd],
                ['initial', data.initialMarginUsd],
                ['maintenance', data.maintenanceMarginUsd],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <dt>{t(label)}</dt>
                <dd>{value == null ? '—' : money.format(value)}</dd>
              </div>
            ))}
          </dl>
          {data.settlementAsset && <small>{t('unit', { asset: data.settlementAsset })}</small>}
          {venue === 'Thalex' && <small>{t('maintenanceMissing')}</small>}
          {!!data.unpricedAssets?.length && (
            <small className={styles.warning}>
              {t('unpriced', { assets: data.unpricedAssets.join(', ') })}
            </small>
          )}
          {onUseEquity && (
            <button
              type="button"
              disabled={!fresh || data.equityUsd <= 0 || !!data.unpricedAssets?.length}
              onClick={() => onUseEquity(data.equityUsd)}
            >
              {t('useEquity')}
            </button>
          )}
        </>
      ) : (
        <p>
          {session.status !== 'ready'
            ? t('connect', { venue })
            : isPending
              ? t('loading', { venue })
              : t('unavailable', { venue })}
        </p>
      )}
    </section>
  );
}
