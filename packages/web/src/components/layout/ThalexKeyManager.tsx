import { activateThalexEnvironment, useThalexKeySlots } from '@features/portfolio';
import { defineMessages, useT } from '@lib/i18n';
import { connectVenue, disconnectVenue } from '@lib/venue-connections-api';
import type { ThalexKeySlot, VenueEnvironment } from '@oggregator/protocol';
import { useState } from 'react';

import styles from './ThalexKeyManager.module.css';

type Access = 'read_only' | 'trading';

const ENVIRONMENTS: readonly VenueEnvironment[] = ['prod', 'test'];
const NETWORK_LABEL: Record<VenueEnvironment, string> = { prod: 'Mainnet', test: 'Testnet' };
/** The trading vault: its own origin, so nothing on this site can reach the keys it holds. */
const VAULT_URL = import.meta.env.VITE_VAULT_URL ?? 'https://trade.oggregator.xyz';

const messages = defineMessages(
  {
    failed: '{label} failed',
    missing: 'Missing: Key ID (kid), RSA private key (PEM)',
    saving: 'Saving',
    switchingTo: 'Switching to {network}',
    removing: 'Removing',
    loadError: "Couldn't load which keys are saved. The server may be running an older build.",
    thalexKeys: 'Thalex keys',
    readOnly: 'Read-only',
    trading: 'Trading',
    network: 'Network',
    access: 'Access',
    tradingNotice:
      'Trading keys never come to oggregator or to this page. Add them in your vault: a separate site that keeps them encrypted on this device, out of reach of this site, and only sends an order after you confirm it there.',
    openVault: 'Open the vault ↗',
    kid: 'Key ID (kid) *',
    kidPlaceholder: 'from thalex dashboard',
    pem: 'RSA private key (PEM) *',
    accountNumber: 'Account number',
    accountPlaceholder: 'optional: connect a non-default account',
    confirm:
      'This key has trading and withdrawals turned off in Thalex. Thalex does not let a key report its own permissions, so this cannot be checked automatically.',
    replaces: 'Replaces the saved {network} key and switches the portfolio to it.',
    save: 'Save {network} read-only key',
    unknown: 'unknown',
    none: 'none',
    inUse: 'in use',
    inUseOffline: 'in use · offline',
    saved: 'saved',
    use: 'use',
    removeKeyAria: 'remove key',
    removeKey: 'Remove this key',
  },
  {
    failed: '{label} falló',
    missing: 'Falta: Key ID (kid), clave privada RSA (PEM)',
    saving: 'Guardando',
    switchingTo: 'Cambiando a {network}',
    removing: 'Eliminando',
    loadError:
      'No se pudo cargar qué claves están guardadas. Puede que el servidor tenga una versión anterior.',
    thalexKeys: 'Claves de Thalex',
    readOnly: 'Solo lectura',
    trading: 'Trading',
    network: 'Red',
    access: 'Acceso',
    tradingNotice:
      'Las claves de trading nunca llegan a oggregator ni a esta página. Agrégalas en tu bóveda: un sitio aparte que las guarda cifradas en este dispositivo, fuera del alcance de este sitio, y solo envía una orden después de que la confirmes allí.',
    openVault: 'Abrir la bóveda ↗',
    kid: 'Key ID (kid) *',
    kidPlaceholder: 'desde el panel de thalex',
    pem: 'Clave privada RSA (PEM) *',
    accountNumber: 'Número de cuenta',
    accountPlaceholder: 'opcional: conecta una cuenta que no sea la predeterminada',
    confirm:
      'Esta clave tiene el trading y los retiros desactivados en Thalex. Thalex no permite que una clave informe sus propios permisos, así que esto no se puede verificar automáticamente.',
    replaces: 'Reemplaza la clave de {network} guardada y cambia el portafolio a ella.',
    save: 'Guardar clave de solo lectura de {network}',
    unknown: 'desconocido',
    none: 'ninguna',
    inUse: 'en uso',
    inUseOffline: 'en uso · offline',
    saved: 'guardada',
    use: 'usar',
    removeKeyAria: 'quitar clave',
    removeKey: 'Quitar esta clave',
  },
);

interface ThalexKeyManagerProps {
  /** Called after any change, with whether a Thalex key is still stored. */
  onChanged: (anyKeyStored: boolean) => void;
  onError: (message: string | null) => void;
}

/**
 * Thalex keys per network. Read-only keys are saved here for the portfolio. Trading keys live only
 * in the user's vault (charter D11), which this site cannot see, so this never accepts one.
 */
export default function ThalexKeyManager({ onChanged, onError }: ThalexKeyManagerProps) {
  const t = useT(messages);
  const slotsQuery = useThalexKeySlots();
  const slots = slotsQuery.data?.slots ?? [];
  const activeEnvironment = slots.find((slot) => slot.active)?.environment;

  const [network, setNetwork] = useState<VenueEnvironment>(
    () => (activeEnvironment === 'test' ? 'test' : 'prod'),
  );
  const [access, setAccess] = useState<Access>('read_only');
  const [kid, setKid] = useState('');
  const [privateKeyPem, setPrivateKeyPem] = useState('');
  const [account, setAccount] = useState('');
  const [confirmedReadOnly, setConfirmedReadOnly] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const slotFor = (environment: VenueEnvironment) =>
    slots.find((slot) => slot.environment === environment);

  const run = async (label: string, action: () => Promise<unknown>) => {
    onError(null);
    setBusy(label);
    try {
      await action();
      const refreshed = await slotsQuery.refetch();
      onChanged(refreshed.data?.slots.some((slot) => slot.configured) ?? true);
      return true;
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : t('failed', { label }));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (kid.trim() === '' || privateKeyPem.trim() === '') {
      onError(t('missing'));
      return;
    }
    const saved = await run(t('saving'), () =>
      connectVenue('thalex', {
        kid: kid.trim(),
        privateKeyPem: privateKeyPem.trim(),
        ...(account.trim() !== '' ? { account: account.trim() } : {}),
        env: network,
      }),
    );
    if (saved) {
      setKid('');
      setPrivateKeyPem('');
      setAccount('');
      setConfirmedReadOnly(false);
    }
  };

  const savedSlot = slotFor(network);

  return (
    <div className={styles.wrap}>
      {slotsQuery.isError && (
        <div className={styles.unknown} role="alert">
          {t('loadError')}
        </div>
      )}
      <table className={styles.matrix} aria-label={t('thalexKeys')}>
        <thead>
          <tr>
            <th />
            <th>{t('readOnly')}</th>
          </tr>
        </thead>
        <tbody>
          {ENVIRONMENTS.map((environment) => (
            <tr key={environment} data-network={environment}>
              <th scope="row" className={styles.networkCell}>
                {NETWORK_LABEL[environment]}
              </th>
              <td>
                <ReadOnlyCell
                  unknown={slotsQuery.isError}
                  slot={slotFor(environment)}
                  busy={busy != null}
                  onUse={() =>
                    void run(t('switchingTo', { network: NETWORK_LABEL[environment] }), () =>
                      activateThalexEnvironment(environment),
                    )
                  }
                  onRemove={() =>
                    void run(t('removing'), () => disconnectVenue('thalex', environment))
                  }
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className={styles.controls}>
        <Segmented
          label={t('network')}
          value={network}
          options={ENVIRONMENTS.map((environment) => ({
            value: environment,
            label: NETWORK_LABEL[environment],
          }))}
          onChange={setNetwork}
        />
        <Segmented
          label={t('access')}
          value={access}
          options={[
            { value: 'read_only', label: t('readOnly') },
            { value: 'trading', label: t('trading') },
          ]}
          onChange={setAccess}
        />
      </div>

      {access === 'trading' ? (
        <div className={styles.notice}>
          <p>{t('tradingNotice')}</p>
          <a href={VAULT_URL} target="_blank" rel="noopener noreferrer" className={styles.vaultLink}>
            {t('openVault')}
          </a>
        </div>
      ) : (
        <>
          <label className={styles.field}>
            <span>{t('kid')}</span>
            <input
              value={kid}
              onChange={(e) => setKid(e.target.value)}
              placeholder={t('kidPlaceholder')}
              autoComplete="off"
            />
          </label>
          <label className={styles.field}>
            <span>{t('pem')}</span>
            <textarea
              value={privateKeyPem}
              onChange={(e) => setPrivateKeyPem(e.target.value)}
              placeholder={'-----BEGIN RSA PRIVATE KEY-----\n…'}
              rows={4}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label className={styles.field}>
            <span>{t('accountNumber')}</span>
            <input
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              placeholder={t('accountPlaceholder')}
              autoComplete="off"
            />
          </label>
          <label className={styles.confirm}>
            <input
              type="checkbox"
              checked={confirmedReadOnly}
              onChange={(e) => setConfirmedReadOnly(e.target.checked)}
            />
            <span>{t('confirm')}</span>
          </label>
          {savedSlot?.configured && (
            <div className={styles.hint}>
              {t('replaces', { network: NETWORK_LABEL[network].toLowerCase() })}
            </div>
          )}
          <button
            type="button"
            className={styles.saveBtn}
            data-network={network}
            disabled={!confirmedReadOnly || busy != null}
            onClick={() => void save()}
          >
            {t('save', { network: NETWORK_LABEL[network].toLowerCase() })}
          </button>
        </>
      )}
      {busy != null && <div className={styles.hint}>{busy}…</div>}
    </div>
  );
}

function ReadOnlyCell({
  unknown,
  slot,
  busy,
  onUse,
  onRemove,
}: {
  unknown: boolean;
  slot: ThalexKeySlot | undefined;
  busy: boolean;
  onUse: () => void;
  onRemove: () => void;
}) {
  const t = useT(messages);
  if (unknown) return <span className={styles.warn}>{t('unknown')}</span>;
  if (slot == null || !slot.configured) return <span className={styles.none}>{t('none')}</span>;
  return (
    <span className={styles.cell}>
      <span className={styles.state} data-state={slot.active ? 'active' : 'saved'}>
        {slot.active ? (slot.connected ? t('inUse') : t('inUseOffline')) : t('saved')}
      </span>
      {slot.kidHint != null && <span className={styles.kid}>…{slot.kidHint}</span>}
      {!slot.active && (
        <button type="button" className={styles.linkBtn} disabled={busy} onClick={onUse}>
          {t('use')}
        </button>
      )}
      <button
        type="button"
        className={styles.removeBtn}
        disabled={busy}
        onClick={onRemove}
        aria-label={t('removeKeyAria')}
        title={t('removeKey')}
      >
        ×
      </button>
    </span>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className={styles.segmentedRow}>
      <span className={styles.segmentedLabel}>{label}</span>
      <div className={styles.segmented} role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            data-active={value === option.value || undefined}
            data-value={option.value}
            className={styles.segment}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
