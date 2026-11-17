import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { VenueEnvironment } from '@oggregator/protocol';

import { useParadexKeySlots, activateParadexEnvironment } from '@features/portfolio';
import { connectVenue, disconnectVenue } from '@lib/venue-connections-api';
import { defineMessages, useT } from '@lib/i18n';
import styles from './ThalexKeyManager.module.css';

const messages = defineMessages(
  {
    title: 'Paradex read-only keys', network: 'Network', token: 'Read-only token',
    prod: 'Mainnet', test: 'Testnet', none: 'No saved key', active: 'In use', saved: 'Saved',
    offline: 'Offline', use: 'Use', remove: 'Remove', save: 'Save and use key',
    pending: 'Updating…', missing: 'Paste a read-only token for the selected network.',
    unavailable: 'Saved keys could not be loaded.',
    note: 'Save a separate token for each network. Testnet positions and fills are excluded from mainnet history and leaderboards.',
  },
  {
    title: 'Claves de solo lectura de Paradex', network: 'Red', token: 'Token de solo lectura',
    prod: 'Mainnet', test: 'Testnet', none: 'Sin clave guardada', active: 'En uso', saved: 'Guardada',
    offline: 'Sin conexión', use: 'Usar', remove: 'Eliminar', save: 'Guardar y usar clave',
    pending: 'Actualizando…', missing: 'Pega un token de solo lectura para la red seleccionada.',
    unavailable: 'No se pudieron cargar las claves guardadas.',
    note: 'Guarda un token por red. Las posiciones y los fills de testnet se excluyen del historial y los rankings de mainnet.',
  },
);

export default function ParadexKeyManager({ onChanged, onError }: {
  onChanged: (configured: boolean) => void;
  onError: (message: string | null) => void;
}) {
  const t = useT(messages);
  const query = useParadexKeySlots();
  const queryClient = useQueryClient();
  const [network, setNetwork] = useState<VenueEnvironment>('prod');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    onError(null);
    try {
      await action();
      setToken('');
      await queryClient.invalidateQueries({ predicate: (entry) => entry.queryKey.includes('portfolio') });
      const refreshed = await query.refetch();
      onChanged(refreshed.data?.slots.some((slot) => slot.configured) ?? true);
    } catch (error) {
      onError(error instanceof Error ? error.message : t('unavailable'));
    } finally {
      setBusy(false);
    }
  };

  return <div className={styles.wrap}>
    {query.isError && <div role="alert">{t('unavailable')}</div>}
    <table className={styles.matrix} aria-label={t('title')}>
      <thead><tr><th>{t('network')}</th><th>{t('title')}</th></tr></thead>
      <tbody>{(['prod', 'test'] as const).map((environment) => {
        const slot = query.data?.slots.find((row) => row.environment === environment);
        return <tr key={environment} data-network={environment}>
          <th scope="row" className={styles.networkCell}>{t(environment)}</th>
          <td>
            {slot?.configured ? <>
              <span className={styles.state} data-state={slot.active ? 'active' : 'saved'}>{slot.active ? t('active') : t('saved')}{slot.active && !slot.connected ? ` · ${t('offline')}` : ''}</span>
              {slot.account && <div className={styles.kid} title={slot.account}>{slot.account.length > 22 ? `${slot.account.slice(0, 10)}…${slot.account.slice(-8)}` : slot.account}</div>}
              {(!slot.active || !slot.connected) && <button type="button" disabled={busy} className={styles.linkBtn}
                onClick={() => void run(() => activateParadexEnvironment(environment))}>{t('use')}</button>}
              <button type="button" disabled={busy} className={styles.removeBtn}
                onClick={() => void run(() => disconnectVenue('paradex', environment))}>{t('remove')}</button>
            </> : t('none')}
          </td>
        </tr>;
      })}</tbody>
    </table>
    <div className={styles.segmentedRow}><span className={styles.segmentedLabel}>{t('network')}</span>
      <div className={styles.segmented} role="group" aria-label={t('network')}>
        {(['prod', 'test'] as const).map((env) => <button key={env} type="button" className={styles.segment}
          data-active={network === env || undefined} data-value={env} aria-pressed={network === env}
          disabled={busy} onClick={() => setNetwork(env)}>{t(env)}</button>)}
      </div>
    </div>
    <label className={styles.field}>{t('token')} <input type="password" autoComplete="off" value={token} disabled={busy}
      onChange={(event) => setToken(event.target.value)} /></label>
    <p className={styles.hint}>{t('note')}</p>
    <button type="button" className={styles.saveBtn} data-network={network} disabled={busy} onClick={() => {
      if (token.trim() === '') { onError(t('missing')); return; }
      void run(() => connectVenue('paradex', { readonlyToken: token.trim(), env: network }));
    }}>{busy ? t('pending') : t('save')}</button>
  </div>;
}
