import { createCipheriv, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  cipherFromEnv,
  parsePreviousKeys,
  VenueCredentialCipher,
  venueCredentialContext,
} from './venue-credential-cipher.js';

const keyA = Buffer.alloc(32, 1).toString('base64');
const keyB = Buffer.alloc(32, 2).toString('base64');
const context = venueCredentialContext('acct_1', 'thalex');

function legacyEncrypt(rawKey: string, value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(rawKey, 'base64'), iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return ['v1', iv, cipher.getAuthTag(), ct].map((p) => (typeof p === 'string' ? p : p.toString('base64url'))).join('.');
}

describe('VenueCredentialCipher', () => {
  it('round-trips credentials as v2 without exposing plaintext', () => {
    const cipher = new VenueCredentialCipher(keyA);
    const credentials = { privateKeyPem: 'secret-key', account: 'account-1' };

    const encrypted = cipher.encrypt(credentials, context);

    expect(encrypted.startsWith('v2.k1.')).toBe(true);
    expect(encrypted).not.toContain('secret-key');
    expect(cipher.decrypt(encrypted, context)).toEqual(credentials);
  });

  it('refuses a payload moved to another account or venue', () => {
    const cipher = new VenueCredentialCipher(keyA);
    const encrypted = cipher.encrypt({ secret: 'value' }, context);

    expect(() => cipher.decrypt(encrypted, venueCredentialContext('acct_2', 'thalex'))).toThrow();
    expect(() => cipher.decrypt(encrypted, venueCredentialContext('acct_1', 'derive'))).toThrow();
  });

  it('rejects ciphertext encrypted with another key', () => {
    const first = new VenueCredentialCipher(keyA);
    const second = new VenueCredentialCipher(keyB);

    expect(() => second.decrypt(first.encrypt({ secret: 'value' }, context), context)).toThrow();
  });

  it('decrypts rows written under a retired key after rotation', () => {
    const before = new VenueCredentialCipher(keyA, { keyId: 'k1' });
    const encrypted = before.encrypt({ secret: 'value' }, context);
    const after = new VenueCredentialCipher(keyB, { keyId: 'k2', previousKeys: { k1: keyA } });

    expect(after.decrypt(encrypted, context)).toEqual({ secret: 'value' });
    expect(after.needsRewrap(encrypted)).toBe(true);
    expect(after.needsRewrap(after.encrypt({ secret: 'value' }, context))).toBe(false);
  });

  it('still reads legacy v1 payloads and flags them for rewrap', () => {
    const legacy = legacyEncrypt(keyA, { secret: 'old' });
    const cipher = new VenueCredentialCipher(keyB, { keyId: 'k2', previousKeys: { k1: keyA } });

    expect(cipher.decrypt(legacy, context)).toEqual({ secret: 'old' });
    expect(cipher.needsRewrap(legacy)).toBe(true);
  });

  it('rejects malformed payloads and unknown key ids', () => {
    const cipher = new VenueCredentialCipher(keyA);
    expect(() => cipher.decrypt('v3.a.b.c', context)).toThrow(/Unsupported/);
    expect(() => cipher.decrypt('v2.zz.a.b.c', context)).toThrow(/Unknown venue credential key id/);
  });

  it('requires a 32-byte encryption key and a valid key id', () => {
    expect(() => new VenueCredentialCipher(Buffer.alloc(16).toString('base64'))).toThrow(
      /exactly 32 bytes/,
    );
    expect(() => new VenueCredentialCipher(keyA, { keyId: 'bad.id' })).toThrow(/key ids/);
    expect(() => new VenueCredentialCipher(keyA, { keyId: 'k1', previousKeys: { k1: keyB } })).toThrow(
      /clashes/,
    );
  });
});

describe('cipher configuration', () => {
  it('parses previous keys', () => {
    expect(parsePreviousKeys(` k0:${keyA} , k9:${keyB}`)).toEqual({ k0: keyA, k9: keyB });
    expect(parsePreviousKeys(undefined)).toEqual({});
    expect(() => parsePreviousKeys('nokey')).toThrow(/id:key/);
  });

  it('builds from env', () => {
    expect(cipherFromEnv({})).toBeNull();
    const cipher = cipherFromEnv({
      VENUE_CREDENTIALS_ENCRYPTION_KEY: keyB,
      VENUE_CREDENTIALS_KEY_ID: 'k2',
      VENUE_CREDENTIALS_PREVIOUS_KEYS: `k1:${keyA}`,
    })!;
    expect(cipher.encrypt({}, context).startsWith('v2.k2.')).toBe(true);
  });
});
