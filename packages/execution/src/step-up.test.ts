import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KeyCipher } from './cipher.js';
import { Journal } from './journal.js';
import { StepUpSecretStore, StepUpVerifier } from './step-up.js';
import { totpCode, totpCounter } from './totp.js';

const owner = { clerkUserId: 'user_1', accountId: 'acct_1' };
const other = { clerkUserId: 'user_2', accountId: 'acct_2' };
const SECRET = Buffer.from('12345678901234567890', 'ascii');
const NOW = 1_760_000_000_000;

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'ogg-stepup-'));
  const cipher = new KeyCipher('k1', Buffer.alloc(32, 7));
  const secrets = new StepUpSecretStore(dir, cipher);
  const journal = Journal.memory();
  let now = NOW;
  const verifier = new StepUpVerifier({ secrets, journal, now: () => now });
  return {
    dir,
    cipher,
    secrets,
    journal,
    verifier,
    advance: (ms: number) => {
      now += ms;
    },
    code: (offsetSteps = 0) => totpCode(SECRET, totpCounter(now) + offsetSteps),
  };
}

describe('StepUpSecretStore', () => {
  it('stores the secret encrypted, owner-only, and bound to its actor', () => {
    const { dir, cipher, secrets } = setup();
    secrets.enroll(owner, SECRET);

    const files = readdirSync(join(dir, 'totp'));
    expect(files).toHaveLength(1);
    const raw = readFileSync(join(dir, 'totp', files[0]!), 'utf8');
    expect(raw).not.toContain(SECRET.toString('base64'));
    expect(secrets.loadSecret(owner)).toEqual(SECRET);
    expect(secrets.isEnrolled(other)).toBe(false);
    expect(secrets.loadSecret(other)).toBeNull();
    const envelope = JSON.parse(raw).encryptedSecret as string;
    expect(() => cipher.decrypt(envelope, 'totp_secret|user_2|acct_2')).toThrow();
  });
});

describe('StepUpVerifier', () => {
  it('accepts a current code once and journals it without the code', () => {
    const { secrets, verifier, journal, code } = setup();
    secrets.enroll(owner, SECRET);
    const current = code();

    expect(verifier.verify(owner, current, 'arm')).toEqual({ ok: true });
    expect(verifier.verify(owner, current, 'arm')).toEqual({ ok: false, code: 'step_up_failed' });
    const last = journal.lastOfType(['step_up_rejected']);
    expect(last?.payload).toMatchObject({ action: 'arm', reason: 'reused' });
    expect(JSON.stringify(last?.payload)).not.toContain(current);
  });

  it('rejects an older step after a newer one was used', () => {
    const { secrets, verifier, code } = setup();
    secrets.enroll(owner, SECRET);
    expect(verifier.verify(owner, code(1), 'arm').ok).toBe(true);
    expect(verifier.verify(owner, code(0), 'reset')).toEqual({ ok: false, code: 'step_up_failed' });
  });

  it('refuses a user who has not enrolled', () => {
    const { verifier } = setup();
    expect(verifier.verify(owner, '123456', 'arm')).toEqual({ ok: false, code: 'step_up_not_enrolled' });
  });

  it("never accepts one user's code for another user", () => {
    const { secrets, verifier, code } = setup();
    secrets.enroll(owner, SECRET);
    secrets.enroll(other, Buffer.alloc(20, 3));
    expect(verifier.verify(other, code(), 'arm').ok).toBe(false);
  });

  it('locks out after five failures in fifteen minutes, then recovers', () => {
    const { secrets, verifier, advance, code } = setup();
    secrets.enroll(owner, SECRET);
    for (let i = 0; i < 4; i += 1) {
      expect(verifier.verify(owner, '000000', 'arm')).toEqual({ ok: false, code: 'step_up_failed' });
    }
    expect(verifier.verify(owner, '000000', 'arm')).toEqual({ ok: false, code: 'step_up_locked' });
    expect(verifier.verify(owner, code(), 'arm')).toEqual({ ok: false, code: 'step_up_locked' });

    advance(15 * 60_000 + 1);
    expect(verifier.verify(owner, code(), 'arm')).toEqual({ ok: true });
  });
});
