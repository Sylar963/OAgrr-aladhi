import { SignInButton } from '@clerk/react';
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
import { useEffect, useMemo, useRef, useState } from 'react';

import styles from './AccountChip.module.css';

type Mode = 'home' | 'paste';

const CONNECTABLE_VENUE_IDS = VENUE_IDS.filter(
  (venue) => PRIVATE_ADAPTER_SPECS[venue].status === 'available',
);

function emptyVenueFields(venue: VenueId): Record<VenueCredentialFieldKey, string> {
  const spec = PRIVATE_ADAPTER_SPECS[venue];
  const fields: Partial<Record<VenueCredentialFieldKey, string>> = {};
  for (const field of spec.credentialFields) fields[field.key] = '';
  return fields as Record<VenueCredentialFieldKey, string>;
}

export default function AccountChip() {
  const accountId = useAppStore((s) => s.accountId);
  const configuredVenueIds = useAppStore((state) => state.configuredVenueIds);
  const markVenueConfigured = useAppStore((state) => state.markVenueConfigured);
  const markVenueUnconfigured = useAppStore((state) => state.markVenueUnconfigured);
  const qc = useQueryClient();
  const accountSession = useAccountSession();
  const isAccountReady = accountSession.status === 'ready';
  const isSignedOut = accountSession.status === 'signed_out';

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('home');
  const [pasteTarget, setPasteTarget] = useState<VenueId>(CONNECTABLE_VENUE_IDS[0]!);
  const [venueFields, setVenueFields] = useState<Record<VenueCredentialFieldKey, string>>(() =>
    emptyVenueFields(CONNECTABLE_VENUE_IDS[0]!),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

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

    if (venue === 'derive') {
      setBusy(true);
      try {
        const subaccountId = Number(trimmedFields.subaccountId ?? '');
        if (!Number.isFinite(subaccountId) || subaccountId <= 0) {
          throw new Error('Subaccount ID must be a positive integer');
        }
        await connectVenue('derive', {
          walletAddress: trimmedFields.walletAddress ?? '',
          signerPrivateKey: trimmedFields.privateKeyPem ?? '',
          subaccountId,
        });
        markVenueConfigured('derive');
        refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'connect failed');
        setBusy(false);
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
    if (venue === 'derive' || venue === 'thalex') {
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
      <button
        type="button"
        className={styles.chip}
        data-signed-in={isAccountReady || undefined}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <span className={styles.dot} />
        {isSignedOut ? 'Sign in' : accountId ? `acct ${acctShort}` : 'Account loading'}
        {configuredVenues.length > 0 && (
          <span className={styles.venueBadge}>+{configuredVenues.length}</span>
        )}
      </button>
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
                    {accountId != null && <div className={styles.value}>{accountId}</div>}
                  </div>
                )}
              </div>
              {isAccountReady && <div className={styles.divider} />}
              {isAccountReady && (
                <div className={styles.section}>
                  <div className={styles.label}>Venue API keys</div>
                  {configuredVenues.length === 0 ? (
                    <div className={styles.hint}>
                      No venue keys yet. Add keys to enable per-venue private feeds.
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
                    + Add venue key
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
              <VenueCredentialForm
                venue={pasteTarget}
                values={venueFields}
                onChange={(key, value) => setVenueFields((prev) => ({ ...prev, [key]: value }))}
                onSubmit={onPasteVenue}
              />
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
