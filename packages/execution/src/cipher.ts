import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v2';

/**
 * Same `v2.<keyId>.<iv>.<tag>.<ciphertext>` AES-256-GCM envelope as the server's credential
 * cipher, with the binding context as AAD. Kept separate because the daemon must not depend on
 * the server package, and it never needs the legacy v1 format.
 */
export class KeyCipher {
  constructor(
    private readonly keyId: string,
    private readonly key: Buffer,
  ) {
    if (key.length !== 32) throw new Error('Key encryption key must be 32 bytes');
  }

  encrypt(plaintext: string, context: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [
      VERSION,
      this.keyId,
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.');
  }

  decrypt(envelope: string, context: string): string {
    const parts = envelope.split('.');
    if (parts.length !== 5 || parts[0] !== VERSION) throw new Error('Unsupported key envelope');
    const [, keyId, iv, tag, ciphertext] = parts as [string, string, string, string, string];
    if (keyId !== this.keyId) throw new Error(`Key envelope uses unknown key id ${keyId}`);
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(context, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}
