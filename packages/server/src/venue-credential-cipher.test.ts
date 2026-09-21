import { describe, expect, it } from 'vitest';
import { VenueCredentialCipher } from './venue-credential-cipher.js';

describe('VenueCredentialCipher', () => {
  it('round-trips credentials without exposing plaintext', () => {
    const cipher = new VenueCredentialCipher(Buffer.alloc(32, 7).toString('base64'));
    const credentials = { privateKeyPem: 'secret-key', account: 'account-1' };

    const encrypted = cipher.encrypt(credentials);

    expect(encrypted).not.toContain('secret-key');
    expect(cipher.decrypt(encrypted)).toEqual(credentials);
  });

  it('rejects ciphertext encrypted with another key', () => {
    const first = new VenueCredentialCipher(Buffer.alloc(32, 1).toString('base64'));
    const second = new VenueCredentialCipher(Buffer.alloc(32, 2).toString('base64'));

    expect(() => second.decrypt(first.encrypt({ secret: 'value' }))).toThrow();
  });

  it('requires a 32-byte encryption key', () => {
    expect(() => new VenueCredentialCipher(Buffer.alloc(16).toString('base64'))).toThrow(
      /exactly 32 bytes/,
    );
  });
});
