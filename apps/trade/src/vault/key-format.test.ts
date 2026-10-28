import { createPrivateKey, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { KeyFormatError, pemToPkcs8 } from './key-format';

const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pkcs1Pem = rsa.privateKey.export({ type: 'pkcs1', format: 'pem' }) as string;
const pkcs8Pem = rsa.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
const pkcs8Der = rsa.privateKey.export({ type: 'pkcs8', format: 'der' });

describe('pemToPkcs8', () => {
  it('wraps a Thalex-style PKCS#1 key into the exact PKCS#8 DER', () => {
    expect(pkcs1Pem).toContain('BEGIN RSA PRIVATE KEY');
    expect(Buffer.from(pemToPkcs8(pkcs1Pem))).toEqual(pkcs8Der);
  });

  it('passes a PKCS#8 RSA key through unchanged, tolerating pasted whitespace', () => {
    const messy = `\n  ${pkcs8Pem.replaceAll('\n', '\r\n')}  \n`;
    expect(Buffer.from(pemToPkcs8(messy))).toEqual(pkcs8Der);
  });

  it('produces a key the platform accepts', () => {
    const der = Buffer.from(pemToPkcs8(pkcs1Pem));
    expect(createPrivateKey({ key: der, format: 'der', type: 'pkcs8' }).asymmetricKeyType).toBe('rsa');
  });

  it('rejects encrypted, non-RSA, truncated and junk input', () => {
    const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({
      type: 'pkcs8',
      format: 'pem',
    }) as string;
    const encrypted = rsa.privateKey.export({
      type: 'pkcs8',
      format: 'pem',
      cipher: 'aes-256-cbc',
      passphrase: 'secret',
    }) as string;
    for (const bad of [ec, encrypted, pkcs1Pem.slice(0, 200), 'hello', '']) {
      expect(() => pemToPkcs8(bad)).toThrow(KeyFormatError);
    }
  });
});
