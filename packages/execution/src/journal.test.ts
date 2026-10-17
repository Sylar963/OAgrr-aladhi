import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Journal } from './journal.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('Journal', () => {
  it('chains appended entries and verifies them', () => {
    const journal = Journal.memory();
    const a = journal.append('user_1', 'kill', { reason: 'test' }, 1);
    const b = journal.append('system', 'reset', { reason: 'ok' }, 2);

    expect(a.seq).toBe(1);
    expect(b.prevHash).toBe(a.hash);
    expect(journal.lastSeq()).toBe(2);
    expect(journal.verifyChain()).toBeNull();
    expect(journal.lastOfType(['kill', 'reset'])?.type).toBe('reset');
  });

  it('refuses updates and deletes', () => {
    const journal = Journal.memory();
    journal.append('user_1', 'kill', { reason: 'test' });

    expect(() => journal.unsafeExecForTests("UPDATE journal SET actor = 'x'")).toThrow(/append-only/);
    expect(() => journal.unsafeExecForTests('DELETE FROM journal')).toThrow(/append-only/);
  });

  it('detects a tampered row once triggers are bypassed', () => {
    const journal = Journal.memory();
    journal.append('user_1', 'arm', {});
    journal.append('user_1', 'kill', { reason: 'test' });
    journal.unsafeExecForTests('DROP TRIGGER journal_no_update');
    journal.unsafeExecForTests(`UPDATE journal SET payload = '{"reason":"edited"}' WHERE seq = 2`);

    expect(journal.verifyChain()).toBe(2);
  });

  it('stores idempotent responses once', () => {
    const journal = Journal.memory();
    journal.saveIdempotentResponse('acct_1', 'k', 'first');
    journal.saveIdempotentResponse('acct_1', 'k', 'second');

    expect(journal.getIdempotentResponse('acct_1', 'k')).toBe('first');
    expect(journal.getIdempotentResponse('acct_2', 'k')).toBeNull();
  });

  it('creates a private on-disk store that survives reopening', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ogg-journal-'));
    dirs.push(dir);
    const state = join(dir, 'state');
    const first = Journal.open(state);
    first.append('user_1', 'kill', { reason: 'test' });
    first.close();

    expect(statSync(state).mode & 0o777).toBe(0o700);
    expect(statSync(join(state, 'journal.sqlite')).mode & 0o777).toBe(0o600);
    const second = Journal.open(state);
    expect(second.lastSeq()).toBe(1);
    expect(second.verifyChain()).toBeNull();
    second.close();
  });
});
