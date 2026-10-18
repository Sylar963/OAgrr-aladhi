import { createCipheriv, randomBytes } from 'node:crypto';
import type { StoredVenueCredentialSlot } from '@oggregator/db';
import { describe, expect, it } from 'vitest';
import { VenueCredentialCipher, venueCredentialContext } from './venue-credential-cipher.js';
import { rewrapVenueCredentials } from './venue-credential-rewrap.js';

const keyA = Buffer.alloc(32, 1).toString('base64');
const keyB = Buffer.alloc(32, 2).toString('base64');

function legacyEncrypt(rawKey: string, value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(rawKey, 'base64'), iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

type Row = Omit<StoredVenueCredentialSlot, 'environment' | 'active'> &
  Partial<Pick<StoredVenueCredentialSlot, 'environment'>>;

function memoryStore(rows: Row[]) {
  const data = new Map(
    rows.map((r) => {
      const slot: StoredVenueCredentialSlot = { environment: 'prod', active: true, ...r };
      return [`${r.accountId}:${r.venue}:${slot.environment}`, slot];
    }),
  );
  return {
    data,
    async listAll() {
      return [...data.values()].map((r) => ({ ...r }));
    },
    async replaceEncrypted(
      accountId: string,
      venue: string,
      environment: string,
      expected: string,
      next: string,
    ) {
      const row = data.get(`${accountId}:${venue}:${environment}`);
      if (!row || row.encryptedCredentials !== expected) return false;
      row.encryptedCredentials = next;
      return true;
    },
  };
}

describe('rewrapVenueCredentials', () => {
  it('moves legacy and retired-key rows to v2 under the current key, and is idempotent', async () => {
    const old = new VenueCredentialCipher(keyA, { keyId: 'k1' });
    const cipher = new VenueCredentialCipher(keyB, { keyId: 'k2', previousKeys: { k1: keyA } });
    const store = memoryStore([
      { accountId: 'a1', venue: 'thalex', encryptedCredentials: legacyEncrypt(keyA, { kid: 'K1' }) },
      {
        accountId: 'a2',
        venue: 'paradex',
        encryptedCredentials: old.encrypt({ t: 1 }, venueCredentialContext('a2', 'paradex')),
      },
      {
        accountId: 'a3',
        venue: 'derive',
        encryptedCredentials: cipher.encrypt({ d: 1 }, venueCredentialContext('a3', 'derive')),
      },
    ]);

    const first = await rewrapVenueCredentials(store, cipher);
    expect(first).toEqual({ rewrapped: 2, current: 1, changedConcurrently: 0, failed: [] });
    for (const row of store.data.values()) {
      expect(row.encryptedCredentials.startsWith('v2.k2.')).toBe(true);
    }
    expect(
      cipher.decrypt(store.data.get('a1:thalex:prod')!.encryptedCredentials, venueCredentialContext('a1', 'thalex')),
    ).toEqual({ kid: 'K1' });

    const second = await rewrapVenueCredentials(store, cipher);
    expect(second).toEqual({ rewrapped: 0, current: 3, changedConcurrently: 0, failed: [] });
  });

  it('reports rows it cannot decrypt without touching them', async () => {
    const cipher = new VenueCredentialCipher(keyB, { keyId: 'k2' });
    const unreadable = legacyEncrypt(keyA, { kid: 'K1' });
    const store = memoryStore([{ accountId: 'a1', venue: 'thalex', encryptedCredentials: unreadable }]);

    const report = await rewrapVenueCredentials(store, cipher);

    expect(report.failed).toEqual([
      expect.objectContaining({ accountId: 'a1', venue: 'thalex', environment: 'prod' }),
    ]);
    expect(store.data.get('a1:thalex:prod')!.encryptedCredentials).toBe(unreadable);
  });

  it('re-encrypts a testnet slot under its own environment context', async () => {
    const old = new VenueCredentialCipher(keyA, { keyId: 'k1' });
    const cipher = new VenueCredentialCipher(keyB, { keyId: 'k2', previousKeys: { k1: keyA } });
    const store = memoryStore([
      {
        accountId: 'a1',
        venue: 'thalex',
        environment: 'test',
        encryptedCredentials: old.encrypt({ kid: 'T' }, venueCredentialContext('a1', 'thalex', 'test')),
      },
    ]);

    expect(await rewrapVenueCredentials(store, cipher)).toMatchObject({ rewrapped: 1, failed: [] });
    const rewrapped = store.data.get('a1:thalex:test')!.encryptedCredentials;
    expect(cipher.decrypt(rewrapped, venueCredentialContext('a1', 'thalex', 'test'))).toEqual({ kid: 'T' });
    expect(() => cipher.decrypt(rewrapped, venueCredentialContext('a1', 'thalex'))).toThrow();
  });
});
