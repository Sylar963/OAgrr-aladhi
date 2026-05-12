import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { useAppStore } from '@stores/app-store';
import { registerUser } from '@features/trading/api';

import styles from './AccountChip.module.css';

type Mode = 'register' | 'paste';

export default function AccountChip() {
  const apiKey = useAppStore((s) => s.apiKey);
  const accountId = useAppStore((s) => s.accountId);
  const setAuth = useAppStore((s) => s.setAuth);
  const clearAuth = useAppStore((s) => s.clearAuth);
  const qc = useQueryClient();

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('register');
  const [label, setLabel] = useState('Trader');
  const [pastedKey, setPastedKey] = useState('');
  const [pastedAccountId, setPastedAccountId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

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

  const refresh = () => {
    void qc.invalidateQueries();
  };

  const onRegister = async () => {
    const trimmed = label.trim();
    if (trimmed.length < 1 || trimmed.length > 50) {
      setError('Label must be 1–50 characters');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await registerUser(trimmed);
      setAuth(result.apiKey, result.userId, result.accountId);
      refresh();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setBusy(false);
    }
  };

  const onPaste = () => {
    const key = pastedKey.trim();
    const acct = pastedAccountId.trim();
    if (key.length < 8) {
      setError('API key looks too short');
      return;
    }
    if (acct.length < 1) {
      setError('Account ID required');
      return;
    }
    setAuth(key, 'paste', acct);
    refresh();
    setOpen(false);
  };

  const onLogout = () => {
    clearAuth();
    refresh();
    setOpen(false);
  };

  const onCopyKey = async () => {
    if (apiKey == null) return;
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Copy failed');
    }
  };

  const signedIn = apiKey != null && accountId != null;
  const acctShort = accountId != null ? accountId.slice(0, 8) : '';

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.chip}
        data-signed-in={signedIn || undefined}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <span className={styles.dot} />
        {signedIn ? `acct ${acctShort}` : 'Sign in'}
      </button>
      {open && (
        <div className={styles.popover} role="dialog">
          {signedIn ? (
            <div className={styles.body}>
              <div className={styles.section}>
                <div className={styles.label}>Account</div>
                <div className={styles.value}>{accountId}</div>
              </div>
              <div className={styles.section}>
                <div className={styles.label}>API key</div>
                <div className={styles.keyRow}>
                  <code className={styles.key}>
                    {apiKey.slice(0, 6)}…{apiKey.slice(-4)}
                  </code>
                  <button type="button" className={styles.smallBtn} onClick={onCopyKey}>
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
              <button type="button" className={styles.dangerBtn} onClick={onLogout}>
                Sign out
              </button>
            </div>
          ) : (
            <div className={styles.body}>
              <div className={styles.modeRow}>
                <button
                  type="button"
                  className={styles.modeBtn}
                  data-active={mode === 'register' || undefined}
                  onClick={() => {
                    setMode('register');
                    setError(null);
                  }}
                >
                  Create new
                </button>
                <button
                  type="button"
                  className={styles.modeBtn}
                  data-active={mode === 'paste' || undefined}
                  onClick={() => {
                    setMode('paste');
                    setError(null);
                  }}
                >
                  Paste existing
                </button>
              </div>
              {mode === 'register' ? (
                <>
                  <label className={styles.field}>
                    <span>Label</span>
                    <input
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void onRegister();
                      }}
                      placeholder="Trader"
                      autoFocus
                    />
                  </label>
                  <button
                    type="button"
                    className={styles.primaryBtn}
                    onClick={onRegister}
                    disabled={busy}
                  >
                    {busy ? 'Creating…' : 'Create account'}
                  </button>
                  <div className={styles.hint}>
                    Generates an API key and a $25k paper account. Stored in this browser.
                  </div>
                </>
              ) : (
                <>
                  <label className={styles.field}>
                    <span>API key</span>
                    <input
                      value={pastedKey}
                      onChange={(e) => setPastedKey(e.target.value)}
                      placeholder="pk_…"
                      autoFocus
                    />
                  </label>
                  <label className={styles.field}>
                    <span>Account ID</span>
                    <input
                      value={pastedAccountId}
                      onChange={(e) => setPastedAccountId(e.target.value)}
                      placeholder="acct_…"
                    />
                  </label>
                  <button type="button" className={styles.primaryBtn} onClick={onPaste}>
                    Use this key
                  </button>
                  <div className={styles.hint}>
                    Restore a key created earlier (find it in the chip menu after signing in).
                  </div>
                </>
              )}
              {error != null && <div className={styles.error}>{error}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
