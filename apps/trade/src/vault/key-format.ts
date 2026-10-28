/**
 * Thalex hands out RSA keys as PKCS#1 PEM (`BEGIN RSA PRIVATE KEY`). WebCrypto only imports
 * PKCS#8, so a PKCS#1 key is wrapped in a PrivateKeyInfo envelope (RFC 5208) here. No ASN.1
 * library: the envelope is fixed apart from one length, and WebCrypto validates the key itself.
 */

// AlgorithmIdentifier { rsaEncryption (1.2.840.113549.1.1.1), NULL }
const RSA_ALGORITHM_ID = Uint8Array.from([
  0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
]);
const VERSION_ZERO = Uint8Array.from([0x02, 0x01, 0x00]);

export class KeyFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeyFormatError';
  }
}

function derLength(length: number): Uint8Array {
  if (length < 0x80) return Uint8Array.of(length);
  const bytes: number[] = [];
  for (let rest = length; rest > 0; rest = Math.floor(rest / 256)) bytes.unshift(rest & 0xff);
  return Uint8Array.from([0x80 | bytes.length, ...bytes]);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function tlv(tag: number, value: Uint8Array): Uint8Array {
  return concat(Uint8Array.of(tag), derLength(value.length), value);
}

export function wrapPkcs1(pkcs1: Uint8Array): Uint8Array {
  if (pkcs1[0] !== 0x30) throw new KeyFormatError('Not an RSA private key');
  return tlv(0x30, concat(VERSION_ZERO, RSA_ALGORITHM_ID, tlv(0x04, pkcs1)));
}

function hasRsaAlgorithm(pkcs8: Uint8Array): boolean {
  outer: for (let i = 0; i + RSA_ALGORITHM_ID.length <= Math.min(pkcs8.length, 32); i += 1) {
    for (let j = 0; j < RSA_ALGORITHM_ID.length; j += 1) {
      if (pkcs8[i + j] !== RSA_ALGORITHM_ID[j]) continue outer;
    }
    return true;
  }
  return false;
}

function decodeBase64(body: string): Uint8Array {
  try {
    return Uint8Array.from(atob(body), (char) => char.charCodeAt(0));
  } catch {
    throw new KeyFormatError('The key is not valid base64');
  }
}

/** PEM text → PKCS#8 DER, ready for `crypto.subtle.importKey('pkcs8', …)`. */
export function pemToPkcs8(pem: string): Uint8Array {
  const text = pem.trim();
  if (/ENCRYPTED/.test(text)) {
    throw new KeyFormatError('Passphrase-protected PEM keys are not supported; export it unencrypted');
  }
  const match = /^-----BEGIN (RSA PRIVATE KEY|PRIVATE KEY)-----([\s\S]+?)-----END \1-----$/.exec(text);
  if (!match) throw new KeyFormatError('Paste the whole RSA private key, including the BEGIN and END lines');
  const der = decodeBase64(match[2]!.replace(/\s+/g, ''));
  if (match[1] === 'RSA PRIVATE KEY') return wrapPkcs1(der);
  if (!hasRsaAlgorithm(der)) throw new KeyFormatError('Thalex keys are RSA; this key is a different type');
  return der;
}
