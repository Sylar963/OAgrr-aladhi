import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseAnnouncement,
  loadDismissedIds,
  addDismissedId,
  selectActiveNotice,
} from './system-status';
import type { SystemAnnouncement } from '@oggregator/protocol';

const base: SystemAnnouncement = { id: 'a1', severity: 'info', blocking: false, title: 'Hi' };
const NOW = 1_700_000_000_000;

describe('parseAnnouncement', () => {
  it('returns null for null/garbage', () => {
    expect(parseAnnouncement(null)).toBeNull();
    expect(parseAnnouncement({ nope: true })).toBeNull();
  });
  it('parses a valid payload', () => {
    expect(parseAnnouncement({ id: 'a1', severity: 'info', title: 'Hi' })).toMatchObject({ id: 'a1' });
  });
});

describe('dismissal storage', () => {
  beforeEach(() => localStorage.clear());
  it('persists and reloads dismissed ids', () => {
    expect(loadDismissedIds()).toEqual([]);
    addDismissedId('a1');
    expect(loadDismissedIds()).toContain('a1');
  });
});

describe('selectActiveNotice', () => {
  it('returns null when nothing is active', () => {
    expect(selectActiveNotice(null, false, [], NOW)).toEqual({ surface: null, notice: null });
  });

  it('renders a non-blocking announcement as a banner', () => {
    const sel = selectActiveNotice(base, false, [], NOW);
    expect(sel.surface).toBe('banner');
    expect(sel.notice).toMatchObject({ id: 'a1', dismissible: true });
  });

  it('renders a blocking announcement as a takeover', () => {
    const sel = selectActiveNotice({ ...base, blocking: true }, false, [], NOW);
    expect(sel.surface).toBe('takeover');
  });

  it('hides a dismissed info banner but keeps degraded/outage', () => {
    expect(selectActiveNotice(base, false, ['a1'], NOW).surface).toBeNull();
    const degraded: SystemAnnouncement = { ...base, severity: 'degraded' };
    expect(selectActiveNotice(degraded, false, ['a1'], NOW).surface).toBe('banner');
  });

  it('treats an announcement past endsAt as expired', () => {
    const ended: SystemAnnouncement = { ...base, endsAt: NOW - 1 };
    expect(selectActiveNotice(ended, false, [], NOW).surface).toBeNull();
  });

  it('shows the synthesized feed-degraded banner', () => {
    const sel = selectActiveNotice(null, true, [], NOW);
    expect(sel.surface).toBe('banner');
    expect(sel.notice).toMatchObject({ id: null, severity: 'degraded' });
  });

  it('takeover beats a degraded feed banner', () => {
    const sel = selectActiveNotice({ ...base, blocking: true, severity: 'outage' }, true, [], NOW);
    expect(sel.surface).toBe('takeover');
  });

  it('higher severity wins among banners', () => {
    const sel = selectActiveNotice({ ...base, severity: 'info' }, true, [], NOW);
    expect(sel.notice?.severity).toBe('degraded'); // feed degraded outranks info
  });
});
