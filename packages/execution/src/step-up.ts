import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LiveActor } from '@oggregator/protocol';
import { z } from 'zod';
import type { KeyCipher } from './cipher.js';
import { assertPrivate, ensurePrivateDir, restrictFile } from './fs-permissions.js';
import type { Journal } from './journal.js';
import { matchTotp } from './totp.js';

const MAX_FAILURES = 5;
const FAILURE_WINDOW_MS = 15 * 60_000;

const StoredSecretSchema = z.object({
  version: z.literal(1),
  binding: z.object({ clerkUserId: z.string().min(1), accountId: z.string().min(1) }),
  enrolledAt: z.string(),
  encryptedSecret: z.string().min(1),
});

export type StepUpFailure = 'step_up_failed' | 'step_up_not_enrolled' | 'step_up_locked';
export type StepUpResult = { ok: true } | { ok: false; code: StepUpFailure };

export function actorLabel(actor: LiveActor): string {
  return `${actor.clerkUserId}/${actor.accountId}`;
}

function secretContext(actor: LiveActor): string {
  return `totp_secret|${actor.clerkUserId}|${actor.accountId}`;
}

/** One encrypted TOTP secret per actor, bound to that actor as AAD so a copied file won't open. */
export class StepUpSecretStore {
  private readonly dir: string;

  constructor(
    stateDir: string,
    private readonly cipher: KeyCipher,
  ) {
    this.dir = join(stateDir, 'totp');
    ensurePrivateDir(this.dir);
  }

  enroll(actor: LiveActor, secret: Buffer, now: Date = new Date()): void {
    const stored: z.infer<typeof StoredSecretSchema> = {
      version: 1,
      binding: { clerkUserId: actor.clerkUserId, accountId: actor.accountId },
      enrolledAt: now.toISOString(),
      encryptedSecret: this.cipher.encrypt(secret.toString('base64'), secretContext(actor)),
    };
    const path = this.pathFor(actor);
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(stored, null, 2), { mode: 0o600 });
    restrictFile(tmp);
    renameSync(tmp, path);
  }

  isEnrolled(actor: LiveActor): boolean {
    return existsSync(this.pathFor(actor));
  }

  loadSecret(actor: LiveActor): Buffer | null {
    const path = this.pathFor(actor);
    if (!existsSync(path)) return null;
    assertPrivate(path, 0o077);
    const stored = StoredSecretSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    if (
      stored.binding.clerkUserId !== actor.clerkUserId ||
      stored.binding.accountId !== actor.accountId
    ) {
      throw new Error('TOTP file binding does not match its path');
    }
    return Buffer.from(this.cipher.decrypt(stored.encryptedSecret, secretContext(actor)), 'base64');
  }

  private pathFor(actor: LiveActor): string {
    const digest = createHash('sha256')
      .update(`${actor.clerkUserId}|${actor.accountId}`)
      .digest('hex')
      .slice(0, 32);
    return join(this.dir, `totp-${digest}.json`);
  }
}

export interface StepUpVerifierOptions {
  secrets: Pick<StepUpSecretStore, 'loadSecret' | 'isEnrolled'>;
  journal: Pick<Journal, 'append'>;
  now?: () => number;
}

/**
 * The daemon's half of step-up (charter D10). Used steps and failures are kept in memory: a
 * restart needs host access, and the journal keeps the full record either way.
 */
export class StepUpVerifier {
  private readonly lastStep = new Map<string, number>();
  private readonly failures = new Map<string, number[]>();
  private readonly now: () => number;

  constructor(private readonly options: StepUpVerifierOptions) {
    this.now = options.now ?? Date.now;
  }

  isEnrolled(actor: LiveActor): boolean {
    return this.options.secrets.isEnrolled(actor);
  }

  verify(actor: LiveActor, code: string, action: string): StepUpResult {
    const label = actorLabel(actor);
    const now = this.now();
    const recent = (this.failures.get(label) ?? []).filter((ts) => now - ts < FAILURE_WINDOW_MS);
    this.failures.set(label, recent);
    if (recent.length >= MAX_FAILURES) {
      this.options.journal.append(label, 'step_up_rejected', { action, reason: 'locked' });
      return { ok: false, code: 'step_up_locked' };
    }

    const secret = this.options.secrets.loadSecret(actor);
    if (secret === null) {
      this.options.journal.append(label, 'step_up_rejected', { action, reason: 'not_enrolled' });
      return { ok: false, code: 'step_up_not_enrolled' };
    }

    const step = matchTotp(secret, code, now);
    const reused = step !== null && step <= (this.lastStep.get(label) ?? -1);
    if (step === null || reused) {
      recent.push(now);
      this.options.journal.append(label, 'step_up_rejected', {
        action,
        reason: reused ? 'reused' : 'mismatch',
        failures: recent.length,
      });
      return { ok: false, code: recent.length >= MAX_FAILURES ? 'step_up_locked' : 'step_up_failed' };
    }

    this.lastStep.set(label, step);
    this.failures.delete(label);
    this.options.journal.append(label, 'step_up_verified', { action });
    return { ok: true };
  }
}
