import { SignInButton, useUser } from '@clerk/react';
import { useAccountSession } from '@components/auth/AccountSessionProvider';
import { ThalexNetworkBadge } from '@features/portfolio';
import { defineMessages, type Translate, useT } from '@lib/i18n';
import { connectVenue, disconnectVenue } from '@lib/venue-connections-api';
import { VENUES } from '@lib/venue-meta';
import type { DeriveWalletSession } from '@lib/wallet/derive-wallet-connect';
import {
  PRIVATE_ADAPTER_SPECS,
  VENUE_IDS,
  type VenueCredentialFieldKey,
  type VenueId,
} from '@oggregator/protocol';
import { useAppStore } from '@stores/app-store';
import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';

import styles from './AccountChip.module.css';
import ThalexKeyManager from './ThalexKeyManager';

type Mode = 'home' | 'paste';

const messages = defineMessages(
  {
    usernamesOff: 'Usernames are turned off in Clerk; enable them in the Clerk dashboard',
    saveUsernameFailed: 'Could not save username',
    adapterUnavailable: '{venue} private adapter is not available',
    missing: 'Missing: {fields}',
    accountNotReady: 'Account must finish loading before venue keys can be saved',
    connectFailed: 'connect failed',
    disconnectFailed: 'Disconnect failed',
    acct: 'acct {id}',
    chooseUsername: 'Choose a username',
    accountUsername: 'Account username',
    signIn: 'Sign in',
    signOut: 'Sign out',
    accountLoading: 'Account loading',
    changeUsername: 'Change username',
    account: 'Account',
    venueConnections: 'Venue connections',
    noVenues: 'No venues connected yet. Connect one to enable per-venue private feeds.',
    live: 'live',
    manageThalexAria: 'manage thalex keys',
    removeVenueAria: 'remove {venue}',
    manageThalex: 'Manage Thalex keys',
    connectVenue: '+ Connect venue',
    unsupported_one:
      "{venues} private feed not available yet — credentials are encrypted on the server but positions won't appear in the Portfolio tab. Derive and Thalex are live today.",
    unsupported_other:
      "{venues} private feeds not available yet — credentials are encrypted on the server but positions won't appear in the Portfolio tab. Derive and Thalex are live today.",
    help: 'Help',
    takeTour: 'Take the tour',
    keyboardShortcuts: 'Keyboard shortcuts',
    back: '← back',
    venue: 'Venue',
    connecting: 'Connecting…',
    docs: 'docs ↗',
    saveKeys: 'Save {venue} keys',
    walletFailed: 'Wallet connection failed',
    approveKey: 'Approve the read-only key in your wallet…',
    signInDerive: 'Sign in to Derive from your wallet…',
    deriveHint:
      'Your wallet signs twice: a Derive sign-in, then a read-only key for oggregator. The key can read positions but cannot trade or withdraw, and your wallet key never leaves the wallet.',
    connectWallet: 'Connect wallet',
    subaccount: 'Subaccount',
    authorize: 'Authorize read-only access',
    paradexHint:
      'Your wallet signs one Paradex sign-in, then Paradex issues a read-only key for oggregator. The key can read positions but cannot trade or withdraw.',
    waitingWallet: 'Waiting for wallet…',
    pasteParadex: 'Or paste a Paradex read-only key:',
  },
  {
    usernamesOff: 'Los nombres de usuario están desactivados en Clerk; actívalos en el panel de Clerk',
    saveUsernameFailed: 'No se pudo guardar el nombre de usuario',
    adapterUnavailable: 'El adaptador privado de {venue} no está disponible',
    missing: 'Falta: {fields}',
    accountNotReady: 'La cuenta debe terminar de cargar antes de guardar claves de exchange',
    connectFailed: 'falló la conexión',
    disconnectFailed: 'Falló la desconexión',
    acct: 'cuenta {id}',
    chooseUsername: 'Elige un nombre de usuario',
    accountUsername: 'Nombre de usuario de la cuenta',
    signIn: 'Iniciar sesión',
    signOut: 'Cerrar sesión',
    accountLoading: 'Cargando cuenta',
    changeUsername: 'Cambiar nombre de usuario',
    account: 'Cuenta',
    venueConnections: 'Conexiones de exchange',
    noVenues:
      'Aún no hay exchanges conectados. Conecta uno para activar feeds privados por exchange.',
    live: 'activo',
    manageThalexAria: 'gestionar claves de thalex',
    removeVenueAria: 'quitar {venue}',
    manageThalex: 'Gestionar claves de Thalex',
    connectVenue: '+ Conectar exchange',
    unsupported_one:
      '{venues}: feed privado aún no disponible — las credenciales se cifran en el servidor, pero las posiciones no aparecerán en la pestaña Portafolio. Derive y Thalex ya están activos.',
    unsupported_other:
      '{venues}: feeds privados aún no disponibles — las credenciales se cifran en el servidor, pero las posiciones no aparecerán en la pestaña Portafolio. Derive y Thalex ya están activos.',
    help: 'Ayuda',
    takeTour: 'Hacer el recorrido',
    keyboardShortcuts: 'Atajos de teclado',
    back: '← volver',
    venue: 'Exchange',
    connecting: 'Conectando…',
    docs: 'docs ↗',
    saveKeys: 'Guardar claves de {venue}',
    walletFailed: 'Falló la conexión de la wallet',
    approveKey: 'Aprueba la clave de solo lectura en tu wallet…',
    signInDerive: 'Inicia sesión en Derive desde tu wallet…',
    deriveHint:
      'Tu wallet firma dos veces: un inicio de sesión en Derive y luego una clave de solo lectura para oggregator. La clave puede leer posiciones pero no puede operar ni retirar, y la clave de tu wallet nunca sale de la wallet.',
    connectWallet: 'Conectar wallet',
    subaccount: 'Subcuenta',
    authorize: 'Autorizar acceso de solo lectura',
    paradexHint:
      'Tu wallet firma un inicio de sesión en Paradex y luego Paradex emite una clave de solo lectura para oggregator. La clave puede leer posiciones pero no puede operar ni retirar.',
    waitingWallet: 'Esperando la wallet…',
    pasteParadex: 'O pega una clave de solo lectura de Paradex:',
  },
);

type T = Translate<typeof messages.en>;

// Names typed before the chip saved to the Clerk username lived only in this browser.
const DISPLAY_NAME_KEY_PREFIX = 'accountDisplayName:';

function readDisplayName(userId: string | null): string | null {
  if (userId == null) return null;
  try {
    return localStorage.getItem(DISPLAY_NAME_KEY_PREFIX + userId);
  } catch {
    return null;
  }
}

function writeDisplayName(userId: string, name: string | null): void {
  try {
    if (name == null) localStorage.removeItem(DISPLAY_NAME_KEY_PREFIX + userId);
    else localStorage.setItem(DISPLAY_NAME_KEY_PREFIX + userId, name);
  } catch {
    // storage unavailable: the name lasts for this page load only
  }
}

function clerkErrorMessage(error: unknown, t: T): string {
  const first = (
    error as { errors?: Array<{ code?: string; longMessage?: string; message?: string }> }
  )?.errors?.[0];
  if (first?.code === 'form_param_unknown') {
    return t('usernamesOff');
  }
  return (
    first?.longMessage ??
    first?.message ??
    (error instanceof Error ? error.message : t('saveUsernameFailed'))
  );
}

const CONNECTABLE_VENUE_IDS = VENUE_IDS.filter(
  (venue) => PRIVATE_ADAPTER_SPECS[venue].status === 'available',
);

function emptyVenueFields(venue: VenueId): Record<VenueCredentialFieldKey, string> {
  const spec = PRIVATE_ADAPTER_SPECS[venue];
  const fields: Partial<Record<VenueCredentialFieldKey, string>> = {};
  for (const field of spec.credentialFields) fields[field.key] = '';
  return fields as Record<VenueCredentialFieldKey, string>;
}

interface AccountChipProps {
  onOpenShortcuts?: () => void;
}

export default function AccountChip({ onOpenShortcuts }: AccountChipProps) {
  const t = useT(messages);
  const startTour = useAppStore((s) => s.startTour);
  const accountId = useAppStore((s) => s.accountId);
  const configuredVenueIds = useAppStore((state) => state.configuredVenueIds);
  const markVenueConfigured = useAppStore((state) => state.markVenueConfigured);
  const markVenueUnconfigured = useAppStore((state) => state.markVenueUnconfigured);
  const qc = useQueryClient();
  const accountSession = useAccountSession();
  const isAccountReady = accountSession.status === 'ready';
  const isSignedOut = accountSession.status === 'signed_out';
  const { user } = useUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? null;
  const username = user?.username ?? null;
  const userId = accountSession.userId;

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('home');
  const [pasteTarget, setPasteTarget] = useState<VenueId>(CONNECTABLE_VENUE_IDS[0]!);
  const [venueFields, setVenueFields] = useState<Record<VenueCredentialFieldKey, string>>(() =>
    emptyVenueFields(CONNECTABLE_VENUE_IDS[0]!),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(() => readDisplayName(userId));
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDisplayName(readDisplayName(userId));
    setEditingName(false);
  }, [userId]);

  const startEditingName = () => {
    setOpen(false);
    setNameDraft(username ?? displayName ?? '');
    setNameError(null);
    setEditingName(true);
  };

  const cancelEditingName = () => {
    setEditingName(false);
    setNameError(null);
  };

  // The chip name is the Clerk username, which also names the user on the leaderboard and in chat.
  const commitName = async () => {
    if (userId == null || user == null || savingName) return;
    const trimmed = nameDraft.trim();
    if (trimmed.length === 0 || trimmed === username) {
      if (trimmed.length === 0 && displayName != null) {
        writeDisplayName(userId, null);
        setDisplayName(null);
      }
      cancelEditingName();
      return;
    }
    setSavingName(true);
    try {
      await user.update({ username: trimmed });
      writeDisplayName(userId, null);
      setDisplayName(null);
      cancelEditingName();
      void qc.invalidateQueries({ queryKey: ['account', userId, 'social'] });
    } catch (caught) {
      setNameError(clerkErrorMessage(caught, t));
    } finally {
      setSavingName(false);
    }
  };

  const refresh = () => {
    void qc.invalidateQueries();
  };

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (event: MouseEvent) => {
      if (wrapRef.current != null && !wrapRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  useEffect(() => {
    setVenueFields(emptyVenueFields(pasteTarget));
    setError(null);
  }, [pasteTarget]);

  useEffect(() => {
    if (open && isAccountReady) return;
    setVenueFields(emptyVenueFields(pasteTarget));
    setError(null);
    setMode('home');
    if (!isAccountReady && !isSignedOut) setOpen(false);
  }, [isAccountReady, isSignedOut, open, pasteTarget]);

  const acctShort = accountId != null ? accountId.slice(0, 8) : '';
  const accountLabel = username ?? displayName ?? email ?? t('acct', { id: acctShort });
  const configuredVenues = useMemo(
    () => VENUE_IDS.filter((venue) => configuredVenueIds.includes(venue)),
    [configuredVenueIds],
  );
  const hasUnsupportedConfigured = useMemo(
    () => configuredVenues.some((v) => PRIVATE_ADAPTER_SPECS[v].status !== 'available'),
    [configuredVenues],
  );
  const unsupportedVenueLabels = useMemo(
    () =>
      configuredVenues
        .filter((v) => PRIVATE_ADAPTER_SPECS[v].status !== 'available')
        .map((v) => VENUES[v]?.label ?? v),
    [configuredVenues],
  );

  const onPasteVenue = async () => {
    const venue = pasteTarget;
    const spec = PRIVATE_ADAPTER_SPECS[venue];
    if (spec.status !== 'available') {
      setError(t('adapterUnavailable', { venue }));
      return;
    }
    const missing: string[] = [];
    for (const field of spec.credentialFields) {
      if (field.required && (venueFields[field.key] ?? '').trim().length === 0) {
        missing.push(field.label);
      }
    }
    if (missing.length > 0) {
      setError(t('missing', { fields: missing.join(', ') }));
      return;
    }
    const trimmedFields: Record<VenueCredentialFieldKey, string> = { ...venueFields };
    for (const key of Object.keys(trimmedFields) as VenueCredentialFieldKey[]) {
      trimmedFields[key] = trimmedFields[key]!.trim();
    }
    if (!isAccountReady) {
      setError(t('accountNotReady'));
      return;
    }

    if (venue === 'paradex') {
      setBusy(true);
      try {
        await connectVenue('paradex', { readonlyToken: trimmedFields.readonlyToken ?? '' });
        markVenueConfigured('paradex');
        refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : t('connectFailed'));
        return;
      } finally {
        setBusy(false);
      }
    }

    setVenueFields(emptyVenueFields(venue));
    setError(null);
    setMode('home');
  };

  const onRemoveVenue = async (venue: VenueId) => {
    if (!isAccountReady) return;
    // Thalex can hold a mainnet and a testnet key; removal is per network in the key manager.
    if (venue === 'thalex') {
      setPasteTarget('thalex');
      setError(null);
      setMode('paste');
      return;
    }
    if (venue === 'derive' || venue === 'paradex') {
      try {
        await disconnectVenue(venue);
        markVenueUnconfigured(venue);
        refresh();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : t('disconnectFailed'));
      }
    }
  };

  return (
    <div className={styles.wrap} ref={wrapRef} data-tour="account">
      <div className={styles.chip} data-signed-in={isAccountReady || undefined}>
        {editingName ? (
          <>
            <span className={styles.dot} />
            <input
              className={styles.nameInput}
              value={nameDraft}
              onChange={(e) => {
                setNameDraft(e.target.value);
                setNameError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void commitName();
                if (e.key === 'Escape') cancelEditingName();
              }}
              onBlur={() => {
                if (nameError == null) void commitName();
              }}
              placeholder={t('chooseUsername')}
              aria-label={t('accountUsername')}
              aria-invalid={nameError != null}
              maxLength={64}
              disabled={savingName}
              autoFocus
            />
          </>
        ) : (
          <button
            type="button"
            className={styles.chipMain}
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-haspopup="dialog"
            title={accountId != null ? accountLabel : undefined}
          >
            <span className={styles.dot} />
            <span className={styles.chipLabel}>
              {isSignedOut ? t('signIn') : accountId ? accountLabel : t('accountLoading')}
            </span>
            {configuredVenues.length > 0 && (
              <span className={styles.venueBadge}>+{configuredVenues.length}</span>
            )}
          </button>
        )}
        {isAccountReady && !editingName && (
          <button
            type="button"
            className={styles.chipEdit}
            onClick={startEditingName}
            aria-label={t('changeUsername')}
            title={t('changeUsername')}
          >
            ×
          </button>
        )}
      </div>
      {editingName && nameError && (
        <p className={styles.nameError} role="alert">
          {nameError}
        </p>
      )}
      {open && (
        <div className={styles.popover} role="dialog">
          {mode === 'home' && (
            <div className={styles.body}>
              <div className={styles.section}>
                <div className={styles.label}>{t('account')}</div>
                {isSignedOut ? (
                  <div className={styles.actionRow}>
                    <SignInButton mode="modal">
                      <button type="button" className={styles.primaryBtn}>
                        {t('signIn')}
                      </button>
                    </SignInButton>
                  </div>
                ) : (
                  <div className={styles.actionRow}>
                    {isAccountReady && (
                      <button
                        type="button"
                        className={styles.dangerBtn}
                        onClick={() => void accountSession.endSession()}
                      >
                        {t('signOut')}
                      </button>
                    )}
                    <div>
                      {email != null && <div className={styles.value}>{email}</div>}
                      {accountId != null && <div className={styles.hint}>{accountId}</div>}
                    </div>
                  </div>
                )}
              </div>
              {isAccountReady && <div className={styles.divider} />}
              {isAccountReady && (
                <div className={styles.section}>
                  <div className={styles.label}>{t('venueConnections')}</div>
                  {configuredVenues.length === 0 ? (
                    <div className={styles.hint}>
                      {t('noVenues')}
                    </div>
                  ) : (
                    <div className={styles.venueChipsRow}>
                      {configuredVenues.map((venue) => (
                        <div key={venue} className={styles.venueChip}>
                          <span>{VENUES[venue]?.label ?? venue}</span>
                          {venue === 'thalex' && <ThalexNetworkBadge />}
                          <span
                            className={styles.venueChipStatus}
                            data-status={PRIVATE_ADAPTER_SPECS[venue].status}
                          >
                            {PRIVATE_ADAPTER_SPECS[venue].status === 'available' ? t('live') : 'TODO'}
                          </span>
                          <button
                            type="button"
                            className={styles.venueChipRemove}
                            onClick={() => onRemoveVenue(venue)}
                            aria-label={
                              venue === 'thalex' ? t('manageThalexAria') : t('removeVenueAria', { venue })
                            }
                            title={venue === 'thalex' ? t('manageThalex') : undefined}
                          >
                            {venue === 'thalex' ? '⚙' : '×'}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <button
                    type="button"
                    className={styles.secondaryBtn}
                    onClick={() => {
                      setPasteTarget(CONNECTABLE_VENUE_IDS[0]!);
                      setError(null);
                      setMode('paste');
                    }}
                  >
                    {t('connectVenue')}
                  </button>
                  {hasUnsupportedConfigured && (
                    <div className={styles.warning}>
                      {t(unsupportedVenueLabels.length === 1 ? 'unsupported_one' : 'unsupported_other', {
                        venues: unsupportedVenueLabels.join(', '),
                      })}
                    </div>
                  )}
                </div>
              )}
              <div className={styles.divider} />
              <div className={styles.section}>
                <div className={styles.label}>{t('help')}</div>
                <button
                  type="button"
                  className={styles.menuItem}
                  onClick={() => {
                    setOpen(false);
                    startTour();
                  }}
                >
                  {t('takeTour')}
                </button>
                {onOpenShortcuts && (
                  <button
                    type="button"
                    className={styles.menuItem}
                    onClick={() => {
                      setOpen(false);
                      onOpenShortcuts();
                    }}
                  >
                    {t('keyboardShortcuts')} <kbd className={styles.kbd}>?</kbd>
                  </button>
                )}
              </div>
            </div>
          )}

          {mode === 'paste' && (
            <div className={styles.body}>
              <button
                type="button"
                className={styles.backBtn}
                onClick={() => {
                  setVenueFields(emptyVenueFields(pasteTarget));
                  setError(null);
                  setMode('home');
                }}
              >
                {t('back')}
              </button>
              <label className={styles.field}>
                <span>{t('venue')}</span>
                <select
                  value={pasteTarget}
                  onChange={(e) => setPasteTarget(e.target.value as VenueId)}
                >
                  {CONNECTABLE_VENUE_IDS.map((v) => (
                    <option key={v} value={v}>
                      {VENUES[v]?.label ?? v}
                    </option>
                  ))}
                </select>
              </label>
              {pasteTarget === 'derive' ? (
                <DeriveWalletConnect
                  onConnected={() => {
                    markVenueConfigured('derive');
                    refresh();
                    setError(null);
                    setMode('home');
                  }}
                  onError={setError}
                />
              ) : pasteTarget === 'paradex' ? (
                <ParadexWalletConnect
                  onConnected={() => {
                    markVenueConfigured('paradex');
                    refresh();
                    setError(null);
                    setMode('home');
                  }}
                  onError={setError}
                >
                  <VenueCredentialForm
                    venue={pasteTarget}
                    values={venueFields}
                    onChange={(key, value) => setVenueFields((prev) => ({ ...prev, [key]: value }))}
                    onSubmit={onPasteVenue}
                  />
                </ParadexWalletConnect>
              ) : pasteTarget === 'thalex' ? (
                <ThalexKeyManager
                  onChanged={(anyKeyStored) => {
                    if (anyKeyStored) markVenueConfigured('thalex');
                    else markVenueUnconfigured('thalex');
                    refresh();
                  }}
                  onError={setError}
                />
              ) : (
                <VenueCredentialForm
                  venue={pasteTarget}
                  values={venueFields}
                  onChange={(key, value) => setVenueFields((prev) => ({ ...prev, [key]: value }))}
                  onSubmit={onPasteVenue}
                />
              )}
              {busy && <div className={styles.hint}>{t('connecting')}</div>}
              {error != null && <div className={styles.error}>{error}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface VenueCredentialFormProps {
  venue: VenueId;
  values: Record<VenueCredentialFieldKey, string>;
  onChange: (key: VenueCredentialFieldKey, value: string) => void;
  onSubmit: () => void;
}

function VenueCredentialForm({ venue, values, onChange, onSubmit }: VenueCredentialFormProps) {
  const t = useT(messages);
  const spec = PRIVATE_ADAPTER_SPECS[venue];
  return (
    <>
      <div className={styles.venueMeta}>
        <span className={styles.venueMetaStatus} data-status={spec.status}>
          {spec.status}
        </span>
        <span className={styles.venueMetaScheme}>{spec.authScheme}</span>
        <a
          className={styles.venueMetaLink}
          href={spec.docsUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t('docs')}
        </a>
      </div>
      {spec.credentialFields.map((field) => (
        <label key={field.key} className={styles.field}>
          <span>
            {field.label}
            {field.required ? ' *' : ''}
          </span>
          {field.multiline ? (
            <textarea
              value={values[field.key] ?? ''}
              onChange={(e) => onChange(field.key, e.target.value)}
              placeholder={field.placeholder}
              rows={4}
              autoComplete="off"
              spellCheck={false}
            />
          ) : (
            <input
              type={field.secret ? 'password' : 'text'}
              value={values[field.key] ?? ''}
              onChange={(e) => onChange(field.key, e.target.value)}
              placeholder={field.placeholder}
              autoComplete="off"
            />
          )}
        </label>
      ))}
      <button type="button" className={styles.primaryBtn} onClick={onSubmit}>
        {t('saveKeys', { venue: VENUES[venue]?.label ?? venue })}
      </button>
    </>
  );
}

type WalletStep =
  | { kind: 'idle' }
  | { kind: 'working'; message: string }
  | { kind: 'choose'; session: DeriveWalletSession; subaccountId: number };

interface DeriveWalletConnectProps {
  onConnected: () => void;
  onError: (message: string | null) => void;
}

function DeriveWalletConnect({ onConnected, onError }: DeriveWalletConnectProps) {
  const t = useT(messages);
  const [step, setStep] = useState<WalletStep>({ kind: 'idle' });
  const sessionRef = useRef<DeriveWalletSession | null>(null);

  useEffect(() => () => sessionRef.current?.cancel(), []);

  const fail = (caught: unknown) => {
    sessionRef.current?.cancel();
    sessionRef.current = null;
    onError(caught instanceof Error ? caught.message : t('walletFailed'));
    setStep({ kind: 'idle' });
  };

  const authorize = async (session: DeriveWalletSession, subaccountId: number) => {
    setStep({ kind: 'working', message: t('approveKey') });
    try {
      await session.authorize(subaccountId);
      sessionRef.current = null;
      onConnected();
    } catch (caught) {
      fail(caught);
    }
  };

  const start = async () => {
    onError(null);
    setStep({ kind: 'working', message: t('signInDerive') });
    try {
      const { startDeriveWalletConnect } = await import('@lib/wallet/derive-wallet-connect');
      const session = await startDeriveWalletConnect();
      sessionRef.current = session;
      if (session.subaccountIds.length === 1) {
        await authorize(session, session.subaccountIds[0]!);
      } else {
        setStep({ kind: 'choose', session, subaccountId: session.subaccountIds[0]! });
      }
    } catch (caught) {
      fail(caught);
    }
  };

  return (
    <>
      <div className={styles.hint}>
        {t('deriveHint')}
      </div>
      {step.kind === 'idle' && (
        <button type="button" className={styles.primaryBtn} onClick={() => void start()}>
          {t('connectWallet')}
        </button>
      )}
      {step.kind === 'working' && <div className={styles.hint}>{step.message}</div>}
      {step.kind === 'choose' && (
        <>
          <label className={styles.field}>
            <span>{t('subaccount')}</span>
            <select
              value={step.subaccountId}
              onChange={(e) => setStep({ ...step, subaccountId: Number(e.target.value) })}
            >
              {step.session.subaccountIds.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={() => void authorize(step.session, step.subaccountId)}
          >
            {t('authorize')}
          </button>
        </>
      )}
    </>
  );
}

interface ParadexWalletConnectProps {
  onConnected: () => void;
  onError: (message: string | null) => void;
  children: ReactNode;
}

function ParadexWalletConnect({ onConnected, onError, children }: ParadexWalletConnectProps) {
  const t = useT(messages);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    onError(null);
    setBusy(true);
    try {
      const { connectParadexWallet } = await import('@lib/wallet/paradex-wallet-connect');
      await connectParadexWallet();
      onConnected();
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : t('walletFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className={styles.hint}>
        {t('paradexHint')}
      </div>
      <button
        type="button"
        className={styles.primaryBtn}
        disabled={busy}
        onClick={() => void start()}
      >
        {busy ? t('waitingWallet') : t('connectWallet')}
      </button>
      <div className={styles.hint}>{t('pasteParadex')}</div>
      {children}
    </>
  );
}
