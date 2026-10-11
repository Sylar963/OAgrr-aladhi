import { SignInButton, useUser } from '@clerk/react';
import { useAccountSession } from '@components/auth/AccountSessionProvider';
import { connectVenue, disconnectVenue } from '@lib/venue-connections-api';
import { VENUES } from '@lib/venue-meta';
import {
  PRIVATE_ADAPTER_SPECS,
  VENUE_IDS,
  type VenueCredentialFieldKey,
  type VenueId,
} from '@oggregator/protocol';
import { useAppStore } from '@stores/app-store';
import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import type { DeriveWalletSession } from '@lib/wallet/derive-wallet-connect';

import styles from './AccountChip.module.css';

type Mode = 'home' | 'paste';

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
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDisplayName(readDisplayName(userId));
    setEditingName(false);
  }, [userId]);

  const startEditingName = () => {
    setOpen(false);
    setNameDraft('');
    setEditingName(true);
  };

  const commitName = () => {
    if (userId == null) return;
    const trimmed = nameDraft.trim();
    const next = trimmed.length > 0 ? trimmed : null;
    writeDisplayName(userId, next);
    setDisplayName(next);
    setEditingName(false);
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
  const accountLabel = displayName ?? email ?? `acct ${acctShort}`;
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
      setError(venue + ' private adapter is not available');
      return;
    }
    const missing: string[] = [];
    for (const field of spec.credentialFields) {
      if (field.required && (venueFields[field.key] ?? '').trim().length === 0) {
        missing.push(field.label);
      }
    }
    if (missing.length > 0) {
      setError(`Missing: ${missing.join(', ')}`);
      return;
    }
    const trimmedFields: Record<VenueCredentialFieldKey, string> = { ...venueFields };
    for (const key of Object.keys(trimmedFields) as VenueCredentialFieldKey[]) {
      trimmedFields[key] = trimmedFields[key]!.trim();
    }
    if (!isAccountReady) {
      setError('Account must finish loading before venue keys can be saved');
      return;
    }

    if (venue === 'paradex') {
      setBusy(true);
      try {
        await connectVenue('paradex', { readonlyToken: trimmedFields.readonlyToken ?? '' });
        markVenueConfigured('paradex');
        refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'connect failed');
        return;
      } finally {
        setBusy(false);
      }
    } else if (venue === 'thalex') {
      setBusy(true);
      try {
        await connectVenue('thalex', {
          kid: trimmedFields.kid ?? '',
          privateKeyPem: trimmedFields.privateKeyPem ?? '',
          ...((trimmedFields.account ?? '') !== '' ? { account: trimmedFields.account } : {}),
        });
        markVenueConfigured('thalex');
        refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'connect failed');
        setBusy(false);
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
    if (venue === 'derive' || venue === 'thalex' || venue === 'paradex') {
      try {
        await disconnectVenue(venue);
        markVenueUnconfigured(venue);
        refresh();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Disconnect failed');
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
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitName();
                if (e.key === 'Escape') setEditingName(false);
              }}
              onBlur={commitName}
              placeholder={email ?? 'Your name'}
              aria-label="Account display name"
              maxLength={40}
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
              {isSignedOut ? 'Sign in' : accountId ? accountLabel : 'Account loading'}
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
            aria-label="Customize account name"
            title="Customize account name"
          >
            ×
          </button>
        )}
      </div>
      {open && (
        <div className={styles.popover} role="dialog">
          {mode === 'home' && (
            <div className={styles.body}>
              <div className={styles.section}>
                <div className={styles.label}>Account</div>
                {isSignedOut ? (
                  <div className={styles.actionRow}>
                    <SignInButton mode="modal">
                      <button type="button" className={styles.primaryBtn}>
                        Sign in
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
                        Sign out
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
                  <div className={styles.label}>Venue connections</div>
                  {configuredVenues.length === 0 ? (
                    <div className={styles.hint}>
                      No venues connected yet. Connect one to enable per-venue private feeds.
                    </div>
                  ) : (
                    <div className={styles.venueChipsRow}>
                      {configuredVenues.map((venue) => (
                        <div key={venue} className={styles.venueChip}>
                          <span>{VENUES[venue]?.label ?? venue}</span>
                          <span
                            className={styles.venueChipStatus}
                            data-status={PRIVATE_ADAPTER_SPECS[venue].status}
                          >
                            {PRIVATE_ADAPTER_SPECS[venue].status === 'available' ? 'live' : 'TODO'}
                          </span>
                          <button
                            type="button"
                            className={styles.venueChipRemove}
                            onClick={() => onRemoveVenue(venue)}
                            aria-label={`remove ${venue}`}
                          >
                            ×
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
                    + Connect venue
                  </button>
                  {hasUnsupportedConfigured && (
                    <div className={styles.warning}>
                      {unsupportedVenueLabels.join(', ')} private feed
                      {unsupportedVenueLabels.length === 1 ? '' : 's'} not available yet —
                      credentials are encrypted on the server but positions won&apos;t appear in the
                      Portfolio tab. Derive and Thalex are live today.
                    </div>
                  )}
                </div>
              )}
              <div className={styles.divider} />
              <div className={styles.section}>
                <div className={styles.label}>Help</div>
                <button
                  type="button"
                  className={styles.menuItem}
                  onClick={() => {
                    setOpen(false);
                    startTour();
                  }}
                >
                  Take the tour
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
                    Keyboard shortcuts <kbd className={styles.kbd}>?</kbd>
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
                ← back
              </button>
              <label className={styles.field}>
                <span>Venue</span>
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
              ) : (
                <VenueCredentialForm
                  venue={pasteTarget}
                  values={venueFields}
                  onChange={(key, value) => setVenueFields((prev) => ({ ...prev, [key]: value }))}
                  onSubmit={onPasteVenue}
                />
              )}
              {busy && <div className={styles.hint}>Connecting…</div>}
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
          docs ↗
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
        Save {VENUES[venue]?.label ?? venue} keys
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
  const [step, setStep] = useState<WalletStep>({ kind: 'idle' });
  const sessionRef = useRef<DeriveWalletSession | null>(null);

  useEffect(() => () => sessionRef.current?.cancel(), []);

  const fail = (caught: unknown) => {
    sessionRef.current?.cancel();
    sessionRef.current = null;
    onError(caught instanceof Error ? caught.message : 'Wallet connection failed');
    setStep({ kind: 'idle' });
  };

  const authorize = async (session: DeriveWalletSession, subaccountId: number) => {
    setStep({ kind: 'working', message: 'Approve the read-only key in your wallet…' });
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
    setStep({ kind: 'working', message: 'Sign in to Derive from your wallet…' });
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
        Your wallet signs twice: a Derive sign-in, then a read-only key for oggregator. The key
        can read positions but cannot trade or withdraw, and your wallet key never leaves the
        wallet.
      </div>
      {step.kind === 'idle' && (
        <button type="button" className={styles.primaryBtn} onClick={() => void start()}>
          Connect wallet
        </button>
      )}
      {step.kind === 'working' && <div className={styles.hint}>{step.message}</div>}
      {step.kind === 'choose' && (
        <>
          <label className={styles.field}>
            <span>Subaccount</span>
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
            Authorize read-only access
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
  const [busy, setBusy] = useState(false);

  const start = async () => {
    onError(null);
    setBusy(true);
    try {
      const { connectParadexWallet } = await import('@lib/wallet/paradex-wallet-connect');
      await connectParadexWallet();
      onConnected();
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : 'Wallet connection failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className={styles.hint}>
        Your wallet signs one Paradex sign-in, then Paradex issues a read-only key for oggregator.
        The key can read positions but cannot trade or withdraw.
      </div>
      <button
        type="button"
        className={styles.primaryBtn}
        disabled={busy}
        onClick={() => void start()}
      >
        {busy ? 'Waiting for wallet…' : 'Connect wallet'}
      </button>
      <div className={styles.hint}>Or paste a Paradex read-only key:</div>
      {children}
    </>
  );
}
