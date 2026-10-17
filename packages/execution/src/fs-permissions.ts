import { chmodSync, mkdirSync, statSync } from 'node:fs';

/**
 * Secrets live under the state dir. Refuse to run if another user could read them; a
 * world-readable key file is a leak even if nothing has read it yet.
 */
export function ensurePrivateDir(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  assertPrivate(path, 0o077);
}

export function assertPrivate(path: string, forbiddenBits: number): void {
  const stat = statSync(path);
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
    throw new Error(`${path} must be owned by the daemon user`);
  }
  if ((stat.mode & forbiddenBits) !== 0) {
    throw new Error(`${path} is accessible to other users (mode ${(stat.mode & 0o777).toString(8)})`);
  }
}

export function restrictFile(path: string): void {
  chmodSync(path, 0o600);
}
