import { z } from 'zod';
import { importSigningKey, openSigningKey, type SealedKey, sealPrivateKey, sign } from './crypto';
import { pemToPkcs8 } from './key-format';

export const DEFAULT_IDLE_LOCK_MS = 15 * 60_000;

export const NetworkSchema = z.enum(['test', 'prod']);
export type Network = z.infer<typeof NetworkSchema>;

const KeyRecordSchema = z.object({
  version: z.literal(1),
  id: z.string(),
  venue: z.literal('thalex'),
  network: NetworkSchema,
  kid: z.string().min(1).max(64),
  account: z.string().max(64).nullable(),
  createdAt: z.string(),
  sealed: z.object({
    kdf: z.object({
      name: z.literal('PBKDF2'),
      hash: z.literal('SHA-256'),
      iterations: z.number().int().positive(),
      salt: z.string(),
    }),
    iv: z.string(),
    ciphertext: z.string(),
  }),
});
export type KeyRecord = z.infer<typeof KeyRecordSchema>;

/** What the UI may show. Never includes key material. */
export interface KeySummary {
  id: string;
  network: Network;
  kid: string;
  account: string | null;
  createdAt: string;
  unlocked: boolean;
}

export interface KeyRecordStore {
  list(): Promise<unknown[]>;
  put(record: KeyRecord): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface AddKeyInput {
  network: Network;
  kid: string;
  account: string | null;
  pem: string;
  passphrase: string;
}

export interface VaultOptions {
  store: KeyRecordStore;
  idleLockMs?: number;
  /** Overridable so tests don't pay the production KDF cost. */
  kdfIterations?: number;
  now?: () => Date;
}

function summarize(record: KeyRecord, unlocked: boolean): KeySummary {
  return {
    id: record.id,
    network: record.network,
    kid: record.kid,
    account: record.account,
    createdAt: record.createdAt,
    unlocked,
  };
}

function recordId(network: Network, kid: string): string {
  return `thalex:${network}:${kid}`;
}

/** Binds a sealed key to its venue, network and key id; a record moved elsewhere won't open. */
function recordAad(record: Pick<KeyRecord, 'network' | 'kid'>): string {
  return `ogg-vault|v1|thalex|${record.network}|${record.kid}`;
}

/**
 * The vault's key ring. Unlocked keys live only in memory as non-extractable CryptoKeys and are
 * dropped on lock, idle timeout or page hide.
 */
export class Vault {
  private readonly unlocked = new Map<string, CryptoKey>();
  private readonly listeners = new Set<() => void>();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly idleLockMs: number;

  constructor(private readonly options: VaultOptions) {
    this.idleLockMs = options.idleLockMs ?? DEFAULT_IDLE_LOCK_MS;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async list(): Promise<KeySummary[]> {
    const records = await this.records();
    return records.map((record) => summarize(record, this.unlocked.has(record.id)));
  }

  /** Validates and test-signs before anything is written. The key is stored locked. */
  async add(input: AddKeyInput): Promise<KeySummary> {
    const kid = input.kid.trim();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(kid)) throw new Error('Key ID looks wrong; copy it from Thalex');
    const pkcs8 = pemToPkcs8(input.pem) as Uint8Array<ArrayBuffer>;
    try {
      const probe = await importSigningKey(pkcs8);
      await sign(probe, 'ogg-vault-import-check');
      const draft = { network: input.network, kid };
      const record: KeyRecord = {
        version: 1,
        id: recordId(input.network, kid),
        venue: 'thalex',
        network: input.network,
        kid,
        account: input.account?.trim() || null,
        createdAt: (this.options.now?.() ?? new Date()).toISOString(),
        sealed: await sealPrivateKey(
          pkcs8,
          input.passphrase,
          recordAad(draft),
          this.options.kdfIterations,
        ),
      };
      await this.options.store.put(record);
      this.emit();
      return summarize(record, false);
    } finally {
      pkcs8.fill(0);
    }
  }

  async unlock(id: string, passphrase: string): Promise<void> {
    const record = (await this.records()).find((r) => r.id === id);
    if (!record) throw new Error('No such key');
    const key = await openSigningKey(record.sealed as SealedKey, passphrase, recordAad(record));
    this.unlocked.set(id, key);
    this.touch();
    this.emit();
  }

  lock(id?: string): void {
    if (id === undefined) this.unlocked.clear();
    else this.unlocked.delete(id);
    if (this.unlocked.size === 0) this.clearIdleTimer();
    this.emit();
  }

  async remove(id: string): Promise<void> {
    this.unlocked.delete(id);
    await this.options.store.delete(id);
    this.emit();
  }

  /** For B1's session. Null when locked. Using a key counts as activity. */
  signingKey(id: string): CryptoKey | null {
    const key = this.unlocked.get(id) ?? null;
    if (key) this.touch();
    return key;
  }

  /** Call on user activity; resets the idle lock. */
  touch(): void {
    if (this.unlocked.size === 0) return;
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => this.lock(), this.idleLockMs);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  /** Records that fail validation are skipped, never trusted. */
  private async records(): Promise<KeyRecord[]> {
    const raw = await this.options.store.list();
    return raw.flatMap((item) => {
      const parsed = KeyRecordSchema.safeParse(item);
      return parsed.success && parsed.data.id === recordId(parsed.data.network, parsed.data.kid)
        ? [parsed.data]
        : [];
    });
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export class MemoryKeyRecordStore implements KeyRecordStore {
  readonly records = new Map<string, unknown>();
  async list(): Promise<unknown[]> {
    return [...this.records.values()];
  }
  async put(record: KeyRecord): Promise<void> {
    this.records.set(record.id, structuredClone(record));
  }
  async delete(id: string): Promise<void> {
    this.records.delete(id);
  }
}
