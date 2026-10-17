import { generateKeyPairSync } from 'node:crypto';
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { KeyCipher } from './cipher.js';
import { type ImportTradingKey, KeyStore } from './key-store.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function stateDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ogg-keys-'));
  dirs.push(dir);
  return join(dir, 'state');
}

const rsaPem = generateKeyPairSync('rsa', { modulusLength: 2048 })
  .privateKey.export({ type: 'pkcs8', format: 'pem' })
  .toString();
const cipher = new KeyCipher('k1', Buffer.alloc(32, 9));
const owner = { clerkUserId: 'user_1', accountId: 'acct_1' };

function input(overrides: Partial<ImportTradingKey> = {}): ImportTradingKey {
  return {
    binding: owner,
    env: 'test',
    kid: 'K123',
    venueAccount: 'A456',
    privateKeyPem: rsaPem,
    attestation: {
      mayTrade: true,
      mayWithdraw: false,
      ipWhitelist: ['51.15.19.220'],
      attestedAt: '2026-10-17T00:00:00.000Z',
    },
    ...overrides,
  };
}

describe('KeyStore', () => {
  it('imports an RSA key encrypted, bound to its owner, in a private file', () => {
    const dir = stateDir();
    const store = new KeyStore(dir, cipher);
    const meta = store.import(input());

    expect(meta).not.toHaveProperty('encryptedPrivateKey');
    const files = readdirSync(join(dir, 'keys'));
    expect(files).toHaveLength(1);
    const path = join(dir, 'keys', files[0]!);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readFileSync(path, 'utf8')).not.toContain('PRIVATE KEY');
    expect(store.loadPrivateKey(owner, 'test')).toBe(rsaPem);
  });

  it('finds keys only for the exact owner', () => {
    const store = new KeyStore(stateDir(), cipher);
    store.import(input());

    expect(store.findForActor(owner)).toHaveLength(1);
    expect(store.findForActor({ clerkUserId: 'user_1', accountId: 'acct_2' })).toHaveLength(0);
    expect(store.findForActor({ clerkUserId: 'user_2', accountId: 'acct_1' })).toHaveLength(0);
  });

  it('refuses a key file moved to another owner', () => {
    const dir = stateDir();
    const store = new KeyStore(dir, cipher);
    store.import(input());
    store.import(input({ binding: { clerkUserId: 'user_2', accountId: 'acct_2' } }));
    const [a, b] = readdirSync(join(dir, 'keys')).map((f) => join(dir, 'keys', f));
    const bodyA = JSON.parse(readFileSync(a!, 'utf8'));
    const bodyB = JSON.parse(readFileSync(b!, 'utf8'));
    writeFileSync(b!, JSON.stringify({ ...bodyB, encryptedPrivateKey: bodyA.encryptedPrivateKey }), {
      mode: 0o600,
    });

    const victim = bodyB.binding as { clerkUserId: string; accountId: string };
    expect(() => store.loadPrivateKey(victim, 'test')).toThrow();
  });

  it('rejects non-RSA keys and attestations that allow withdrawal', () => {
    const store = new KeyStore(stateDir(), cipher);
    const ecPem = generateKeyPairSync('ec', { namedCurve: 'P-256' })
      .privateKey.export({ type: 'pkcs8', format: 'pem' })
      .toString();

    expect(() => store.import(input({ privateKeyPem: ecPem }))).toThrow(/RSA/);
    expect(() =>
      store.import(
        input({
          attestation: { ...input().attestation, mayWithdraw: true as unknown as false },
        }),
      ),
    ).toThrow();
  });

  it('refuses to read a key file other users can read', () => {
    const dir = stateDir();
    const store = new KeyStore(dir, cipher);
    store.import(input());
    const file = join(dir, 'keys', readdirSync(join(dir, 'keys'))[0]!);
    chmodSync(file, 0o644);

    expect(() => store.findForActor(owner)).toThrow(/accessible to other users/);
  });
});
