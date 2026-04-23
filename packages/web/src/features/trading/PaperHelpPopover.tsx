import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useAppStore } from '@stores/app-store';
import { registerUser } from './api';
import styles from './PaperHelpPopover.module.css';

export default function PaperHelpPopover() {
  const apiKey = useAppStore((s) => s.apiKey);
  const setAuth = useAppStore((s) => s.setAuth);
  const clearAuth = useAppStore((s) => s.clearAuth);

  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    if (!apiKey) inputRef.current?.focus();

    function onMouseDown(event: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, apiKey]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = username.trim();
    if (!trimmed) {
      setError('Enter a username.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const result = await registerUser(trimmed);
      setAuth(result.apiKey, result.userId, result.accountId);
      setUsername('');
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setSubmitting(false);
    }
  }

  function handleLogout() {
    clearAuth();
    setOpen(false);
  }

  return (
    <div ref={wrapRef} className={styles.wrap}>
      <button
        type="button"
        className={styles.trigger}
        aria-expanded={open}
        aria-controls="paper-help-popover"
        onClick={() => setOpen((v) => !v)}
      >
        <span>Paper trading help</span>
        <span className={styles.triggerQ} aria-hidden="true">?</span>
      </button>

      {open && (
        <div
          id="paper-help-popover"
          role="dialog"
          aria-label="Paper trading help"
          className={styles.popover}
        >
          <div className={styles.title}>Paper trading</div>

          {apiKey ? (
            <>
              <p className={styles.paragraph}>
                You&apos;re logged in. Your API key is saved in this browser.
              </p>
              <ol className={styles.steps}>
                <li>Build a strategy in the <strong>Builder</strong> tab.</li>
                <li>Click <strong>Send to paper</strong> to open a position.</li>
                <li>Manage trades here — reduce, roll, or close.</li>
              </ol>
              <button type="button" className={styles.buttonSecondary} onClick={handleLogout}>
                Logout
              </button>
            </>
          ) : (
            <>
              <p className={styles.paragraph}>
                Paper trading simulates orders against live venue quotes. Your API key lives in
                this browser only — register below to start.
              </p>
              <ol className={styles.steps}>
                <li>Pick a username and <strong>register</strong>.</li>
                <li>Go to <strong>Builder</strong>, build a strategy, then <strong>Send to paper</strong>.</li>
                <li>Open trades appear here — click to inspect.</li>
              </ol>
              <form className={styles.form} onSubmit={handleSubmit}>
                <label className={styles.inputLabel} htmlFor="paper-help-username">
                  Username
                </label>
                <input
                  id="paper-help-username"
                  ref={inputRef}
                  className={styles.input}
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  maxLength={50}
                  placeholder="Trader"
                  autoComplete="off"
                />
                <button
                  type="submit"
                  className={styles.button}
                  disabled={submitting || username.trim().length === 0}
                >
                  {submitting ? 'Registering…' : 'Register'}
                </button>
                {error && <div className={styles.error}>{error}</div>}
              </form>
            </>
          )}
        </div>
      )}
    </div>
  );
}
