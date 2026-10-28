import { generateKeyPairSync, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  importSigningKey,
  KDF_ITERATIONS,
  openSigningKey,
  sealPrivateKey,
  sign,
  VaultCryptoError,
} from './crypto';
import { pemToPkcs8 } from './key-format';

// Low iteration count keeps the suite fast; production always seals with KDF_ITERATIONS.
const FAST = 1_000;
const AAD = 'ogg-vault|v1|thalex|test|K123';
const PASSPHRASE = 'correct horse battery staple';

const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pkcs8 = () =>
  pemToPkcs8(rsa.privateKey.export({ type: 'pkcs1', format: 'pem' }) as string) as Uint8Array<ArrayBuffer>;

function verifies(signature: Uint8Array, data: string): boolean {
  return verify('sha512', Buffer.from(data), rsa.publicKey, Buffer.from(signature));
}

describe('vault crypto', () => {
  it('seals with the production work factor by default', async () => {
    expect(KDF_ITERATIONS).toBe(600_000);
    const sealed = await sealPrivateKey(pkcs8(), PASSPHRASE, AAD);
    expect(sealed.kdf).toMatchObject({ name: 'PBKDF2', hash: 'SHA-256', iterations: 600_000 });
  });

  it('round-trips into a non-extractable key that signs RS512 verifiably', async () => {
    const sealed = await sealPrivateKey(pkcs8(), PASSPHRASE, AAD, FAST);
    const key = await openSigningKey(sealed, PASSPHRASE, AAD);

    expect(key.extractable).toBe(false);
    expect(key.usages).toEqual(['sign']);
    await expect(crypto.subtle.exportKey('pkcs8', key)).rejects.toThrow();
    expect(verifies(await sign(key, 'header.payload'), 'header.payload')).toBe(true);
  });

  it('never stores the key in clear', async () => {
    const der = pkcs8();
    const sealed = await sealPrivateKey(der, PASSPHRASE, AAD, FAST);
    const stored = Buffer.from(sealed.ciphertext, 'base64');
    expect(stored.includes(Buffer.from(der.slice(64, 96)))).toBe(false);
  });

  it('rejects a wrong passphrase and a record moved to another key or network', async () => {
    const sealed = await sealPrivateKey(pkcs8(), PASSPHRASE, AAD, FAST);
    await expect(openSigningKey(sealed, 'wrong passphrase!', AAD)).rejects.toThrow(VaultCryptoError);
    await expect(
      openSigningKey(sealed, PASSPHRASE, 'ogg-vault|v1|thalex|prod|K123'),
    ).rejects.toThrow(VaultCryptoError);
    const tampered = { ...sealed, ciphertext: `A${sealed.ciphertext.slice(1)}` };
    await expect(openSigningKey(tampered, PASSPHRASE, AAD)).rejects.toThrow(VaultCryptoError);
  });

  it('opens with the same passphrase typed in a different Unicode form', async () => {
    const composed = 'contraseña segura';
    const decomposed = 'contraseña segura';
    const sealed = await sealPrivateKey(pkcs8(), composed, AAD, FAST);
    await expect(openSigningKey(sealed, decomposed, AAD)).resolves.toBeDefined();
  });

  it('refuses short passphrases and non-RSA material', async () => {
    await expect(sealPrivateKey(pkcs8(), 'short', AAD, FAST)).rejects.toThrow(/at least 12/);
    await expect(importSigningKey(new Uint8Array(32))).rejects.toThrow(VaultCryptoError);
  });
});
