/**
 * Key-at-rest and signing, with WebCrypto only. The private key exists in clear only between
 * decrypt and import; after that the vault holds a non-extractable CryptoKey, which can sign but
 * cannot be exported by any script, ours included.
 */

/** OWASP's PBKDF2-HMAC-SHA256 recommendation (2023). */
export const KDF_ITERATIONS = 600_000;
export const MIN_PASSPHRASE_LENGTH = 12;
const SIGNING_ALGORITHM = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-512' } as const;

export interface SealedKey {
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string };
  iv: string;
  ciphertext: string;
}

export class VaultCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VaultCryptoError';
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}

function utf8(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}

/** NFKC so the same passphrase typed on another keyboard layout or OS still opens the key. */
function passphraseBytes(passphrase: string): Uint8Array<ArrayBuffer> {
  return utf8(passphrase.normalize('NFKC'));
}

async function deriveWrappingKey(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', passphraseBytes(passphrase), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** `aad` binds the ciphertext to its record (venue, network, key id) so it can't be swapped. */
export async function sealPrivateKey(
  pkcs8: Uint8Array<ArrayBuffer>,
  passphrase: string,
  aad: string,
  iterations: number = KDF_ITERATIONS,
): Promise<SealedKey> {
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new VaultCryptoError(`Use a passphrase of at least ${MIN_PASSPHRASE_LENGTH} characters`);
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveWrappingKey(passphrase, salt, iterations);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8(aad) }, key, pkcs8),
  );
  return {
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: toBase64(salt) },
    iv: toBase64(iv),
    ciphertext: toBase64(ciphertext),
  };
}

export async function importSigningKey(pkcs8: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  try {
    return await crypto.subtle.importKey('pkcs8', pkcs8, SIGNING_ALGORITHM, false, ['sign']);
  } catch {
    throw new VaultCryptoError('The browser could not use this key as an RSA signing key');
  }
}

/** Wrong passphrase and tampered records fail the same way, on purpose. */
export async function openSigningKey(
  sealed: SealedKey,
  passphrase: string,
  aad: string,
): Promise<CryptoKey> {
  const key = await deriveWrappingKey(passphrase, fromBase64(sealed.kdf.salt), sealed.kdf.iterations);
  let clear: Uint8Array<ArrayBuffer>;
  try {
    clear = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: fromBase64(sealed.iv), additionalData: utf8(aad) },
        key,
        fromBase64(sealed.ciphertext),
      ),
    );
  } catch {
    throw new VaultCryptoError('Wrong passphrase, or this stored key was altered');
  }
  try {
    return await importSigningKey(clear);
  } finally {
    clear.fill(0);
  }
}

export async function sign(key: CryptoKey, data: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign(SIGNING_ALGORITHM, key, utf8(data)));
}
