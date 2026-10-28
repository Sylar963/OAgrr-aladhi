import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { MIN_PASSPHRASE_LENGTH } from './vault/crypto';
import type { KeySummary, Network, Vault } from './vault/vault';

const NETWORK_LABEL: Record<Network, string> = { test: 'Testnet', prod: 'Mainnet' };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong';
}

export default function App({ vault }: { vault: Vault }) {
  const [keys, setKeys] = useState<KeySummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    vault
      .list()
      .then((list) => {
        setKeys(list);
        setLoadError(null);
      })
      .catch((error: unknown) => setLoadError(errorText(error)));
  }, [vault]);

  useEffect(() => {
    refresh();
    return vault.subscribe(refresh);
  }, [vault, refresh]);

  const anyUnlocked = keys.some((key) => key.unlocked);

  return (
    <main className="page">
      <header className="header">
        <div>
          <h1>oggregator vault</h1>
          <p className="muted">
            Your trading keys stay in this browser, encrypted with your passphrase. They are never
            sent to oggregator.
          </p>
        </div>
        {anyUnlocked && (
          <button type="button" className="secondary" onClick={() => vault.lock()}>
            Lock all
          </button>
        )}
      </header>

      {loadError && (
        <p className="error" role="alert">
          {loadError}
        </p>
      )}

      <section className="panel" aria-label="Keys">
        <h2>Keys on this device</h2>
        {keys.length === 0 ? (
          <p className="muted">No keys yet.</p>
        ) : (
          <ul className="keys">
            {keys.map((key) => (
              <KeyRow key={key.id} summary={key} vault={vault} />
            ))}
          </ul>
        )}
      </section>

      <AddKey vault={vault} />

      <section className="panel notes" aria-label="How this protects you">
        <h2>How this protects you</h2>
        <ul>
          <li>Create the Thalex key with trading on and withdrawals off. The worst a misused key can do is trade.</li>
          <li>Unlocked keys can sign but can't be copied out, even by this page. They lock after 15 minutes idle and whenever you leave the page.</li>
          <li>Nothing here can be scripted by the main oggregator site. Orders are only sent after you confirm them on this page.</li>
          <li>Anyone with your device and passphrase can trade. Browser extensions can read pages; use a browser profile without extensions for trading.</li>
          <li>Removing a key here doesn't revoke it at Thalex. Revoke it there if it may be exposed.</li>
        </ul>
      </section>
    </main>
  );
}

function KeyRow({ summary, vault }: { summary: KeySummary; vault: Vault }) {
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  async function unlock(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await vault.unlock(summary.id, passphrase);
      setPassphrase('');
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="key" data-network={summary.network}>
      <div className="keyInfo">
        <span className="badge" data-network={summary.network}>
          {NETWORK_LABEL[summary.network]}
        </span>
        <span className="kid">{summary.kid}</span>
        {summary.account && <span className="muted">account {summary.account}</span>}
        <span className="state" data-unlocked={summary.unlocked || undefined}>
          {summary.unlocked ? 'Unlocked' : 'Locked'}
        </span>
      </div>
      <div className="keyActions">
        {summary.unlocked ? (
          <button type="button" className="secondary" onClick={() => vault.lock(summary.id)}>
            Lock
          </button>
        ) : (
          <form className="inline" onSubmit={(event) => void unlock(event)}>
            <input
              type="password"
              aria-label={`Passphrase for ${summary.kid}`}
              placeholder="Passphrase"
              autoComplete="current-password"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
            />
            <button type="submit" disabled={busy || passphrase.length === 0}>
              {busy ? 'Unlocking…' : 'Unlock'}
            </button>
          </form>
        )}
        {confirmRemove ? (
          <>
            <button type="button" className="danger" onClick={() => void vault.remove(summary.id)}>
              Remove from this device
            </button>
            <button type="button" className="secondary" onClick={() => setConfirmRemove(false)}>
              Keep
            </button>
          </>
        ) : (
          <button type="button" className="secondary" onClick={() => setConfirmRemove(true)}>
            Remove
          </button>
        )}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

function AddKey({ vault }: { vault: Vault }) {
  const [network, setNetwork] = useState<Network>('test');
  const [kid, setKid] = useState('');
  const [account, setAccount] = useState('');
  const [pem, setPem] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [repeat, setRepeat] = useState('');
  const [withdrawalsOff, setWithdrawalsOff] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mismatch = repeat.length > 0 && repeat !== passphrase;
  const ready =
    kid.trim() !== '' &&
    pem.trim() !== '' &&
    passphrase.length >= MIN_PASSPHRASE_LENGTH &&
    repeat === passphrase &&
    withdrawalsOff;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await vault.add({ network, kid, account: account || null, pem, passphrase });
      setKid('');
      setAccount('');
      setPem('');
      setPassphrase('');
      setRepeat('');
      setWithdrawalsOff(false);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" aria-label="Add a Thalex key">
      <h2>Add a Thalex key</h2>
      <form className="form" onSubmit={(event) => void submit(event)}>
        <fieldset className="segmented">
          <legend>Network</legend>
          {(['test', 'prod'] as const).map((value) => (
            <label key={value} data-network={value}>
              <input
                type="radio"
                name="network"
                value={value}
                checked={network === value}
                onChange={() => setNetwork(value)}
              />
              {NETWORK_LABEL[value]}
            </label>
          ))}
        </fieldset>
        <label>
          Key ID (kid)
          <input value={kid} onChange={(e) => setKid(e.target.value)} autoComplete="off" spellCheck={false} />
        </label>
        <label>
          Account number <span className="muted">(optional)</span>
          <input value={account} onChange={(e) => setAccount(e.target.value)} autoComplete="off" spellCheck={false} />
        </label>
        <label>
          RSA private key
          <textarea
            value={pem}
            onChange={(e) => setPem(e.target.value)}
            rows={6}
            placeholder={'-----BEGIN RSA PRIVATE KEY-----\n…'}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <label>
          Passphrase <span className="muted">(at least {MIN_PASSPHRASE_LENGTH} characters)</span>
          <input
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            autoComplete="new-password"
          />
        </label>
        <label>
          Repeat passphrase
          <input
            type="password"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
            autoComplete="new-password"
            aria-invalid={mismatch || undefined}
          />
        </label>
        {mismatch && <p className="error">The passphrases don't match.</p>}
        <label className="check">
          <input
            type="checkbox"
            checked={withdrawalsOff}
            onChange={(e) => setWithdrawalsOff(e.target.checked)}
          />
          This key has withdrawals turned off in Thalex. Thalex doesn't let a key report its own
          permissions, so this can't be checked automatically.
        </label>
        <button type="submit" data-network={network} disabled={!ready || busy}>
          {busy ? 'Encrypting…' : `Save ${NETWORK_LABEL[network].toLowerCase()} key`}
        </button>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}
