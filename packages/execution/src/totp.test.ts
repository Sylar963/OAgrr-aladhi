import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  matchTotp,
  otpauthUri,
  totpCode,
  totpCounter,
} from './totp.js';

// RFC 6238 Appendix B, SHA-1 seed "12345678901234567890", truncated to 6 digits.
const RFC_SECRET = Buffer.from('12345678901234567890', 'ascii');
const RFC_VECTORS: Array<[number, string]> = [
  [59, '287082'],
  [1111111109, '081804'],
  [1111111111, '050471'],
  [1234567890, '005924'],
  [2000000000, '279037'],
  [20000000000, '353130'],
];

describe('TOTP', () => {
  it('matches the RFC 6238 SHA-1 test vectors', () => {
    for (const [seconds, code] of RFC_VECTORS) {
      expect(totpCode(RFC_SECRET, totpCounter(seconds * 1000))).toBe(code);
    }
  });

  it('round-trips base32 the way authenticator apps encode secrets', () => {
    expect(base32Encode(RFC_SECRET)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode('gezd gnbv gy3t qojq gezd gnbv gy3t qojq')).toEqual(RFC_SECRET);
    expect(() => base32Decode('not base32!')).toThrow();
  });

  it('accepts one step of drift either side and nothing further', () => {
    const now = 1_760_000_000_000;
    const step = totpCounter(now);
    expect(matchTotp(RFC_SECRET, totpCode(RFC_SECRET, step), now)).toBe(step);
    expect(matchTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 1), now)).toBe(step - 1);
    expect(matchTotp(RFC_SECRET, totpCode(RFC_SECRET, step + 1), now)).toBe(step + 1);
    expect(matchTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 2), now)).toBeNull();
    expect(matchTotp(RFC_SECRET, '12345', now)).toBeNull();
    expect(matchTotp(RFC_SECRET, 'abcdef', now)).toBeNull();
  });

  it('builds an otpauth URI an authenticator app can scan', () => {
    const uri = new URL(otpauthUri(RFC_SECRET, 'user_1/acct_1'));
    expect(uri.protocol).toBe('otpauth:');
    expect(uri.host).toBe('totp');
    expect(decodeURIComponent(uri.pathname)).toBe('/oggregator:user_1/acct_1');
    expect(uri.searchParams.get('secret')).toBe(base32Encode(RFC_SECRET));
    expect(uri.searchParams.get('digits')).toBe('6');
  });
});
