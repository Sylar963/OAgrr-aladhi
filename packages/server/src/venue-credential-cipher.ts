import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const LEGACY_VERSION = 'v1';
const VERSION = 'v2';
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const DEFAULT_KEY_ID = 'k1';

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

function assertKeyId(keyId: string): void {
  if (!KEY_ID_PATTERN.test(keyId)) {
    throw new Error('Venue credential key ids must match [A-Za-z0-9_-]{1,32}');
  }
}

/** Binds a ciphertext to its row, so a payload copied to another account or venue won't decrypt. */
export function venueCredentialContext(accountId: string, venue: string): string {
  return `venue_credentials|${accountId}|${venue}`;
}

export interface VenueCredentialCipherOptions {
  keyId?: string;
  /** Retired keys, kept only for decrypting rows written before a rotation. */
  previousKeys?: Record<string, string>;
}

/**
 * AES-256-GCM envelope `v2.<keyId>.<iv>.<tag>.<ciphertext>` with the row context as AAD.
 * `v1.<iv>.<tag>.<ciphertext>` (no key id, no AAD) is still readable.
 */
export class VenueCredentialCipher {
  private readonly keyId: string;
  private readonly keys = new Map<string, Buffer>();

  constructor(rawKey: string, options: VenueCredentialCipherOptions = {}) {
    this.keyId = options.keyId ?? DEFAULT_KEY_ID;
    assertKeyId(this.keyId);
    this.keys.set(this.keyId, decodeEncryptionKey(rawKey));
    for (const [id, raw] of Object.entries(options.previousKeys ?? {})) {
      assertKeyId(id);
      if (id === this.keyId) throw new Error(`Previous key id ${id} clashes with the current key`);
      this.keys.set(id, decodeEncryptionKey(raw));
    }
  }

  encrypt(credentials: unknown, context: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.currentKey(), iv);
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const plaintext = Buffer.from(JSON.stringify(credentials), 'utf8');
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return [
      VERSION,
      this.keyId,
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.');
  }

  decrypt<T>(encrypted: string, context: string): T {
    const parts = encrypted.split('.');
    if (parts[0] === VERSION && parts.length === 5) {
      const [, keyId, ivRaw, tagRaw, ciphertextRaw] = parts as [string, string, string, string, string];
      const key = this.keys.get(keyId);
      if (!key) throw new Error(`Unknown venue credential key id ${keyId}`);
      return open<T>(key, ivRaw, tagRaw, ciphertextRaw, context);
    }
    if (parts[0] === LEGACY_VERSION && parts.length === 4) {
      const [, ivRaw, tagRaw, ciphertextRaw] = parts as [string, string, string, string];
      let lastError: unknown;
      for (const key of this.keys.values()) {
        try {
          return open<T>(key, ivRaw, tagRaw, ciphertextRaw, null);
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError;
    }
    throw new Error('Unsupported encrypted venue credential payload');
  }

  /** True when the payload should be rewritten: legacy format or a retired key. */
  needsRewrap(encrypted: string): boolean {
    const parts = encrypted.split('.');
    return parts[0] !== VERSION || parts[1] !== this.keyId;
  }

  private currentKey(): Buffer {
    return this.keys.get(this.keyId)!;
  }
}

function open<T>(
  key: Buffer,
  ivRaw: string,
  tagRaw: string,
  ciphertextRaw: string,
  context: string | null,
): T {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivRaw, 'base64url'));
  if (context !== null) decipher.setAAD(Buffer.from(context, 'utf8'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextRaw, 'base64url')),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString('utf8')) as T;
}

/** `id:key,id:key` → map. */
export function parsePreviousKeys(raw: string | undefined): Record<string, string> {
  const keys: Record<string, string> = {};
  for (const entry of (raw ?? '').split(',').map((v) => v.trim()).filter(Boolean)) {
    const separator = entry.indexOf(':');
    if (separator <= 0) throw new Error('VENUE_CREDENTIALS_PREVIOUS_KEYS entries must be id:key');
    keys[entry.slice(0, separator)] = entry.slice(separator + 1);
  }
  return keys;
}

export function cipherFromEnv(env: NodeJS.ProcessEnv): VenueCredentialCipher | null {
  const rawKey = env['VENUE_CREDENTIALS_ENCRYPTION_KEY'];
  if (!rawKey) return null;
  return new VenueCredentialCipher(rawKey, {
    keyId: env['VENUE_CREDENTIALS_KEY_ID']?.trim() || DEFAULT_KEY_ID,
    previousKeys: parsePreviousKeys(env['VENUE_CREDENTIALS_PREVIOUS_KEYS']),
  });
}

let cipher: VenueCredentialCipher | null | undefined;

export function getVenueCredentialCipher(): VenueCredentialCipher | null {
  if (cipher !== undefined) return cipher;
  cipher = cipherFromEnv(process.env);
  return cipher;
}

export function resetVenueCredentialCipherForTests(): void {
  cipher = undefined;
}
