import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getSystemAnnouncement, __resetSystemStatusCache } from './system-status.js';

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ogg-status-'));
  file = join(dir, 'status.json');
  process.env['STATUS_FILE'] = file;
  __resetSystemStatusCache();
});

afterEach(() => {
  delete process.env['STATUS_FILE'];
  rmSync(dir, { recursive: true, force: true });
});

describe('getSystemAnnouncement', () => {
  it('returns null when STATUS_FILE is unset', () => {
    delete process.env['STATUS_FILE'];
    __resetSystemStatusCache();
    expect(getSystemAnnouncement()).toBeNull();
  });

  it('returns null when the file is missing', () => {
    expect(getSystemAnnouncement()).toBeNull();
  });

  it('parses a valid announcement', () => {
    writeFileSync(file, JSON.stringify({ id: 'm1', severity: 'info', title: 'Maintenance soon' }));
    expect(getSystemAnnouncement()).toMatchObject({ id: 'm1', severity: 'info', blocking: false });
  });

  it('treats a bare null literal as "no announcement"', () => {
    writeFileSync(file, 'null');
    expect(getSystemAnnouncement()).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    writeFileSync(file, '{ not json');
    expect(getSystemAnnouncement()).toBeNull();
  });

  it('returns null for schema-invalid payloads', () => {
    writeFileSync(file, JSON.stringify({ id: 'm1', severity: 'boom', title: 'x' }));
    expect(getSystemAnnouncement()).toBeNull();
  });

  it('caches within the TTL window then refreshes', () => {
    writeFileSync(file, JSON.stringify({ id: 'a', severity: 'info', title: 'A' }));
    const t = Date.now();
    expect(getSystemAnnouncement(t)?.id).toBe('a');
    writeFileSync(file, JSON.stringify({ id: 'b', severity: 'info', title: 'B' }));
    expect(getSystemAnnouncement(t + 1_000)?.id).toBe('a'); // still cached
    expect(getSystemAnnouncement(t + 6_000)?.id).toBe('b'); // TTL expired
  });
});
