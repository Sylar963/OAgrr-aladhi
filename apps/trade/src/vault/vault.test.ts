import { generateKeyPairSync, verify } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sign } from './crypto';
import { MemoryKeyRecordStore, Vault } from './vault';

const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = rsa.privateKey.export({ type: 'pkcs1', format: 'pem' }) as string;
const PASSPHRASE = 'a long enough passphrase';

function vault(idleLockMs = 60_000) {
  const store = new MemoryKeyRecordStore();
  return { store, vault: new Vault({ store, idleLockMs, kdfIterations: 1_000 }) };
}

const testnetKey = { network: 'test' as const, kid: 'K123', account: null, pem: PEM, passphrase: PASSPHRASE };

describe('Vault', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stores a key locked, with no key material in the summary or the record', async () => {
    const { store, vault: v } = vault();
    const summary = await v.add(testnetKey);

    expect(summary).toMatchObject({ id: 'thalex:test:K123', network: 'test', unlocked: false });
    expect(JSON.stringify(summary)).not.toContain('sealed');
    const stored = JSON.stringify([...store.records.values()]);
    expect(stored).not.toContain('PRIVATE KEY');
    expect(stored).not.toContain(PEM.split('\n')[3]!);
    expect(v.signingKey(summary.id)).toBeNull();
  });

  it('unlocks into a signing key and locks again', async () => {
    const { vault: v } = vault();
    const { id } = await v.add(testnetKey);
    await v.unlock(id, PASSPHRASE);

    const key = v.signingKey(id)!;
    const signature = await sign(key, 'payload');
    expect(verify('sha512', Buffer.from('payload'), rsa.publicKey, Buffer.from(signature))).toBe(true);
    expect((await v.list())[0]?.unlocked).toBe(true);

    v.lock(id);
    expect(v.signingKey(id)).toBeNull();
  });

  it('refuses the wrong passphrase and leaves the key locked', async () => {
    const { vault: v } = vault();
    const { id } = await v.add(testnetKey);
    await expect(v.unlock(id, 'not the passphrase')).rejects.toThrow();
    expect(v.signingKey(id)).toBeNull();
  });

  it('keeps mainnet and testnet keys apart, even with the same key id', async () => {
    const { store, vault: v } = vault();
    await v.add(testnetKey);
    await v.add({ ...testnetKey, network: 'prod' });
    expect((await v.list()).map((k) => k.id).sort()).toEqual(['thalex:prod:K123', 'thalex:test:K123']);

    // A testnet record relabelled as mainnet must not open: the network is bound into the seal.
    const testRecord = store.records.get('thalex:test:K123') as Record<string, unknown>;
    store.records.set('thalex:prod:K123', { ...testRecord, id: 'thalex:prod:K123', network: 'prod' });
    await expect(v.unlock('thalex:prod:K123', PASSPHRASE)).rejects.toThrow();
  });

  it('locks every key after the idle timeout, and activity postpones it', async () => {
    vi.useFakeTimers();
    const { vault: v } = vault(1_000);
    const { id } = await v.add(testnetKey);
    await v.unlock(id, PASSPHRASE);

    vi.advanceTimersByTime(800);
    v.touch();
    vi.advanceTimersByTime(800);
    expect(v.signingKey(id)).not.toBeNull();

    vi.advanceTimersByTime(1_001);
    expect(v.signingKey(id)).toBeNull();
  });

  it('ignores records that are malformed or misfiled', async () => {
    const { store, vault: v } = vault();
    await v.add(testnetKey);
    store.records.set('junk', { hello: 'world' });
    store.records.set('thalex:test:OTHER', { ...(store.records.get('thalex:test:K123') as object), id: 'thalex:test:OTHER' });
    expect((await v.list()).map((k) => k.id)).toEqual(['thalex:test:K123']);
  });

  it('rejects a bad key id or a key that cannot sign before storing anything', async () => {
    const { store, vault: v } = vault();
    await expect(v.add({ ...testnetKey, kid: 'has spaces' })).rejects.toThrow(/Key ID/);
    await expect(v.add({ ...testnetKey, pem: 'nonsense' })).rejects.toThrow();
    expect(store.records.size).toBe(0);
  });

  it('forgets an unlocked key when it is removed', async () => {
    const { store, vault: v } = vault();
    const { id } = await v.add(testnetKey);
    await v.unlock(id, PASSPHRASE);
    await v.remove(id);
    expect(v.signingKey(id)).toBeNull();
    expect(store.records.size).toBe(0);
  });
});
