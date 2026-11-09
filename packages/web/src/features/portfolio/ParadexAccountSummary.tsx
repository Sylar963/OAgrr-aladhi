import { useAccountSession } from '@components/auth/AccountSessionProvider';
import { fmtUsd } from '@lib/format';
import { defineMessages, useT } from '@lib/i18n';
import { useParadexAccount } from './hooks/queries';
import styles from './ParadexAccountSummary.module.css';

const messages = defineMessages({
  title: 'Paradex account · all assets',
  equity: 'Equity',
  free: 'Free collateral',
  initial: 'Initial margin',
  maintenance: 'Maintenance margin',
  connect: 'Connect Paradex in Portfolio to see current equity.',
  loading: 'Loading Paradex equity…',
  unavailable: 'Paradex equity unavailable. Check your read-only connection.',
  stale: 'Last fetched {time} · refresh failed',
  fetched: 'Fetched {time}',
  useEquity: 'Use equity for this plan',
  unit: 'Values in {asset}; displayed at 1:1 USD.',
}, {
  title: 'Cuenta Paradex · todos los activos',
  equity: 'Capital',
  free: 'Colateral libre',
  initial: 'Margen inicial',
  maintenance: 'Margen de mantenimiento',
  connect: 'Conecta Paradex en Portafolio para ver el capital actual.',
  loading: 'Cargando capital de Paradex…',
  unavailable: 'Capital de Paradex no disponible. Revisa tu conexión de solo lectura.',
  stale: 'Última consulta {time} · falló la actualización',
  fetched: 'Consultado {time}',
  useEquity: 'Usar capital para este plan',
  unit: 'Valores en {asset}; mostrados a 1:1 USD.',
});

export default function ParadexAccountSummary({ onUseEquity }: { onUseEquity?: (equity: number) => void }) {
  const t = useT(messages);
  const session = useAccountSession();
  const query = useParadexAccount();
  const data = query.data;
  const fresh = data != null && !query.isError && Date.now() - data.fetchedAt < 30_000;
  return (
    <section className={styles.account} aria-label={t('title')}>
      <header>
        <strong>{t('title')}</strong>
        {data && <small data-stale={!fresh}>{t(fresh ? 'fetched' : 'stale', { time: new Date(data.fetchedAt).toLocaleTimeString() })}</small>}
      </header>
      {data ? <>
        <dl>
          {([
            ['equity', data.equityUsd], ['free', data.freeCollateralUsd],
            ['initial', data.initialMarginUsd], ['maintenance', data.maintenanceMarginUsd],
          ] as const).map(([label, value]) => <div key={label}><dt>{t(label)}</dt><dd>{value == null ? '—' : fmtUsd(value)}</dd></div>)}
        </dl>
        {data.settlementAsset && <small>{t('unit', { asset: data.settlementAsset })}</small>}
        {onUseEquity && <button type="button" disabled={!fresh || data.equityUsd <= 0} onClick={() => onUseEquity(data.equityUsd)}>{t('useEquity')}</button>}
      </> : <p>{session.status !== 'ready' ? t('connect') : query.isPending ? t('loading') : t('unavailable')}</p>}
    </section>
  );
}
