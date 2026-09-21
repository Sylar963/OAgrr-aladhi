import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';

function decodeEncryptionKey(raw: string): Buffer {
  const trimmed = raw.trim();
  const key = /^[a-fA-F0-9]{64}$/.test(trimmed)
    ? Buffer.from(trimmed, 'hex')
    : Buffer.from(trimmed, 'base64');
  if (key.length !== 32) {
    throw new Error('VENUE_CREDENTIALS_ENCRYPTION_KEY must decode to exactly 32 bytes');
  }
  return key;
}

export class VenueCredentialCipher {
  private readonly key: Buffer;

  constructor(rawKey: string) {
    this.key = decodeEncryptionKey(rawKey);
  }

  encrypt(credentials: unknown): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const plaintext = Buffer.from(JSON.stringify(credentials), 'utf8');
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      VERSION,
      iv.toString('base64url'),
      tag.toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.');
  }

  decrypt<T>(encrypted: string): T {
    const [version, ivRaw, tagRaw, ciphertextRaw] = encrypted.split('.');
    if (version !== VERSION || !ivRaw || !tagRaw || !ciphertextRaw) {
      throw new Error('Unsupported encrypted venue credential payload');
    }
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivRaw, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextRaw, 'base64url')),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString('utf8')) as T;
  }
}

let cipher: VenueCredentialCipher | null | undefined;

export function getVenueCredentialCipher(): VenueCredentialCipher | null {
  if (cipher !== undefined) return cipher;
  const rawKey = process.env['VENUE_CREDENTIALS_ENCRYPTION_KEY'];
  cipher = rawKey ? new VenueCredentialCipher(rawKey) : null;
  return cipher;
}

export function resetVenueCredentialCipherForTests(): void {
  cipher = undefined;
}
