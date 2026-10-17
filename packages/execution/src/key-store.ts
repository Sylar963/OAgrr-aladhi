import { createHash, createPrivateKey } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LiveActor } from '@oggregator/protocol';
import { z } from 'zod';
import type { KeyCipher } from './cipher.js';
import { assertPrivate, ensurePrivateDir, restrictFile } from './fs-permissions.js';

export const ThalexEnvSchema = z.enum(['test', 'prod']);
export type ThalexEnv = z.infer<typeof ThalexEnvSchema>;

/** The operator confirmed these in the Thalex UI; Thalex has no API for a key to read its own scopes. */
export const KeyAttestationSchema = z.object({
  mayTrade: z.literal(true),
  mayWithdraw: z.literal(false),
  ipWhitelist: z.array(z.string().min(1)).min(1).max(10),
  attestedAt: z.string(),
});
export type KeyAttestation = z.infer<typeof KeyAttestationSchema>;

const StoredKeySchema = z.object({
  version: z.literal(1),
  binding: z.object({ clerkUserId: z.string().min(1), accountId: z.string().min(1) }),
  venue: z.literal('thalex'),
  env: ThalexEnvSchema,
  kid: z.string().min(1).max(64),
  venueAccount: z.string().min(1).max(64),
  importedAt: z.string(),
  attestation: KeyAttestationSchema,
  encryptedPrivateKey: z.string().min(1),
});
type StoredKey = z.infer<typeof StoredKeySchema>;

export type TradingKeyMetadata = Omit<StoredKey, 'encryptedPrivateKey' | 'version'>;

export interface ImportTradingKey {
  binding: LiveActor;
  env: ThalexEnv;
  kid: string;
  venueAccount: string;
  privateKeyPem: string;
  attestation: KeyAttestation;
}

export function keyContext(binding: LiveActor, env: ThalexEnv): string {
  return `thalex_trading_key|${binding.clerkUserId}|${binding.accountId}|${env}`;
}

/** Thalex signs login JWTs with RS256/384/512, so only unencrypted RSA keys are usable. */
export function assertRsaPrivateKey(pem: string): void {
  const key = createPrivateKey({ key: pem, format: 'pem' });
  if (key.asymmetricKeyType !== 'rsa') throw new Error('Thalex keys must be RSA private keys');
}

/**
 * One JSON file per (owner, env). Metadata is plain; only the PEM is encrypted, bound to its
 * owner and env so a file copied to another binding won't decrypt.
 */
export class KeyStore {
  private readonly dir: string;

  constructor(
    stateDir: string,
    private readonly cipher: KeyCipher,
  ) {
    this.dir = join(stateDir, 'keys');
    ensurePrivateDir(this.dir);
  }

  import(input: ImportTradingKey, now: Date = new Date()): TradingKeyMetadata {
    assertRsaPrivateKey(input.privateKeyPem);
    const attestation = KeyAttestationSchema.parse(input.attestation);
    const stored: StoredKey = {
      version: 1,
      binding: { clerkUserId: input.binding.clerkUserId, accountId: input.binding.accountId },
      venue: 'thalex',
      env: input.env,
      kid: input.kid,
      venueAccount: input.venueAccount,
      importedAt: now.toISOString(),
      attestation,
      encryptedPrivateKey: this.cipher.encrypt(
        input.privateKeyPem,
        keyContext(input.binding, input.env),
      ),
    };
    const path = this.pathFor(input.binding, input.env);
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(stored, null, 2), { mode: 0o600 });
    restrictFile(tmp);
    renameSync(tmp, path);
    return metadata(stored);
  }

  /** Keys bound to exactly this owner. Binding is immutable; re-binding means re-importing. */
  findForActor(actor: LiveActor): TradingKeyMetadata[] {
    return this.readAll()
      .filter(
        (k) =>
          k.binding.clerkUserId === actor.clerkUserId && k.binding.accountId === actor.accountId,
      )
      .map(metadata);
  }

  /** Decrypts the PEM for the venue client. Never logged, never returned over the socket. */
  loadPrivateKey(actor: LiveActor, env: ThalexEnv): string {
    const path = this.pathFor(actor, env);
    const stored = this.readFile(path);
    if (
      stored.binding.clerkUserId !== actor.clerkUserId ||
      stored.binding.accountId !== actor.accountId
    ) {
      throw new Error('Key file binding does not match its path');
    }
    return this.cipher.decrypt(stored.encryptedPrivateKey, keyContext(actor, env));
  }

  private readAll(): StoredKey[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => this.readFile(join(this.dir, name)));
  }

  private readFile(path: string): StoredKey {
    assertPrivate(path, 0o077);
    return StoredKeySchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  }

  private pathFor(binding: LiveActor, env: ThalexEnv): string {
    const digest = createHash('sha256')
      .update(`${binding.clerkUserId}|${binding.accountId}|${env}`)
      .digest('hex')
      .slice(0, 32);
    return join(this.dir, `thalex-${env}-${digest}.json`);
  }
}

function metadata(stored: StoredKey): TradingKeyMetadata {
  const { encryptedPrivateKey: _secret, version: _version, ...rest } = stored;
  return rest;
}
