import {
  activateThalexEnvironment,
  type LiveTradingAvailability,
  useLiveTradingAvailability,
  useThalexKeySlots,
} from '@features/portfolio';
import { connectVenue, disconnectVenue } from '@lib/venue-connections-api';
import type { ThalexKeySlot, VenueEnvironment } from '@oggregator/protocol';
import { useState } from 'react';

import styles from './ThalexKeyManager.module.css';

type Access = 'read_only' | 'trading';

const ENVIRONMENTS: readonly VenueEnvironment[] = ['prod', 'test'];
const NETWORK_LABEL: Record<VenueEnvironment, string> = { prod: 'Mainnet', test: 'Testnet' };

interface ThalexKeyManagerProps {
  /** Called after any change, with whether a Thalex key is still stored. */
  onChanged: (anyKeyStored: boolean) => void;
  onError: (message: string | null) => void;
}

/**
 * Thalex keys per network and access level. Read-only keys are saved here for the portfolio;
 * trading keys only ever live on the execution daemon, so this shows their status and never
 * accepts one.
 */
export default function ThalexKeyManager({ onChanged, onError }: ThalexKeyManagerProps) {
  const slotsQuery = useThalexKeySlots();
  const tradingQuery = useLiveTradingAvailability();
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
      onError(caught instanceof Error ? caught.message : `${label} failed`);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (kid.trim() === '' || privateKeyPem.trim() === '') {
      onError('Missing: Key ID (kid), RSA private key (PEM)');
      return;
    }
    const saved = await run('Saving', () =>
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
          Couldn&apos;t load which keys are saved. The server may be running an older build.
        </div>
      )}
      <table className={styles.matrix} aria-label="Thalex keys">
        <thead>
          <tr>
            <th />
            <th>Read-only</th>
            <th>Trading</th>
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
                    void run(`Switching to ${NETWORK_LABEL[environment]}`, () =>
                      activateThalexEnvironment(environment),
                    )
                  }
                  onRemove={() =>
                    void run('Removing', () => disconnectVenue('thalex', environment))
                  }
                />
              </td>
              <td>
                <TradingCell environment={environment} availability={tradingQuery.data} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className={styles.controls}>
        <Segmented
          label="Network"
          value={network}
          options={ENVIRONMENTS.map((environment) => ({
            value: environment,
            label: NETWORK_LABEL[environment],
          }))}
          onChange={setNetwork}
        />
        <Segmented
          label="Access"
          value={access}
          options={[
            { value: 'read_only', label: 'Read-only' },
            { value: 'trading', label: 'Trading' },
          ]}
          onChange={setAccess}
        />
      </div>

      {access === 'trading' ? (
        <div className={styles.notice}>
          Trading keys never go through the browser or this server. The operator installs them on
          the execution daemon host with <code>keys-import</code>, where they stay encrypted and
          only the daemon can use them. See <code>packages/execution/deploy/README.md</code>.
        </div>
      ) : (
        <>
          <label className={styles.field}>
            <span>Key ID (kid) *</span>
            <input
              value={kid}
              onChange={(e) => setKid(e.target.value)}
              placeholder="from thalex dashboard"
              autoComplete="off"
            />
          </label>
          <label className={styles.field}>
            <span>RSA private key (PEM) *</span>
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
            <span>Account number</span>
            <input
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              placeholder="optional: connect a non-default account"
              autoComplete="off"
            />
          </label>
          <label className={styles.confirm}>
            <input
              type="checkbox"
              checked={confirmedReadOnly}
              onChange={(e) => setConfirmedReadOnly(e.target.checked)}
            />
            <span>
              This key has trading and withdrawals turned off in Thalex. Thalex does not let a key
              report its own permissions, so this cannot be checked automatically.
            </span>
          </label>
          {savedSlot?.configured && (
            <div className={styles.hint}>
              Replaces the saved {NETWORK_LABEL[network].toLowerCase()} key and switches the
              portfolio to it.
            </div>
          )}
          <button
            type="button"
            className={styles.saveBtn}
            data-network={network}
            disabled={!confirmedReadOnly || busy != null}
            onClick={() => void save()}
          >
            Save {NETWORK_LABEL[network].toLowerCase()} read-only key
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
  if (unknown) return <span className={styles.warn}>unknown</span>;
  if (slot == null || !slot.configured) return <span className={styles.none}>none</span>;
  return (
    <span className={styles.cell}>
      <span className={styles.state} data-state={slot.active ? 'active' : 'saved'}>
        {slot.active ? (slot.connected ? 'in use' : 'in use · offline') : 'saved'}
      </span>
      {slot.kidHint != null && <span className={styles.kid}>…{slot.kidHint}</span>}
      {!slot.active && (
        <button type="button" className={styles.linkBtn} disabled={busy} onClick={onUse}>
          use
        </button>
      )}
      <button
        type="button"
        className={styles.removeBtn}
        disabled={busy}
        onClick={onRemove}
        aria-label="remove key"
        title="Remove this key"
      >
        ×
      </button>
    </span>
  );
}

function TradingCell({
  environment,
  availability,
}: {
  environment: VenueEnvironment;
  availability: LiveTradingAvailability | undefined;
}) {
  if (availability == null) return <span className={styles.none}>…</span>;
  if (availability.kind === 'off') {
    return <span className={styles.none} title="Live trading is disabled on this deployment">off</span>;
  }
  if (availability.kind === 'not_entitled') {
    return <span className={styles.none} title="This account is not enabled for live trading">—</span>;
  }
  if (availability.kind === 'daemon_unavailable') {
    return <span className={styles.warn} title="The execution daemon is not reachable">daemon down</span>;
  }
  const key = availability.status.tradingKeys.find((k) => k.environment === environment);
  if (key == null) return <span className={styles.none}>none</span>;
  return (
    <span className={styles.cell}>
      <span className={styles.state} data-state="daemon">on daemon</span>
      <span className={styles.kid}>…{key.kidHint}</span>
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
