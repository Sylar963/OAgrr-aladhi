import { describe, expect, it } from 'vitest';
import { SystemAnnouncementSchema } from './system-status.js';

describe('SystemAnnouncementSchema', () => {
  it('parses a minimal valid announcement and defaults blocking to false', () => {
    const r = SystemAnnouncementSchema.safeParse({ id: 'm1', severity: 'info', title: 'Hi' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.blocking).toBe(false);
  });

  it('keeps an explicit blocking flag and optional fields', () => {
    const r = SystemAnnouncementSchema.safeParse({
      id: 'm2',
      severity: 'outage',
      blocking: true,
      title: 'Down',
      message: 'brb',
      startsAt: 1_700_000_000_000,
      endsAt: 1_700_003_600_000,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toMatchObject({ blocking: true, message: 'brb' });
  });

  it('rejects an unknown severity', () => {
    expect(
      SystemAnnouncementSchema.safeParse({ id: 'm1', severity: 'boom', title: 'x' }).success,
    ).toBe(false);
  });

  it('rejects a missing title', () => {
    expect(SystemAnnouncementSchema.safeParse({ id: 'm1', severity: 'info' }).success).toBe(false);
  });
});
