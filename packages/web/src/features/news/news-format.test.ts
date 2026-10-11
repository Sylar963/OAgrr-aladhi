import { describe, expect, it } from 'vitest';
import { categoryLabel, dayLabel, splitHeadline, timeAgo } from './news-format';

describe('splitHeadline', () => {
  it('strips t.co links', () => {
    expect(
      splitHeadline(
        'Canadian ransomware negotiator arrested https://t.co/QsPrZq1trx https://t.co/QsPrZq1trx',
      ),
    ).toEqual({ title: 'Canadian ransomware negotiator arrested', summary: null });
  });

  it('uses the first line as title and the rest as summary', () => {
    expect(splitHeadline('UN Condemns Assault\nGuterres condemned the attack.\n\nMore.')).toEqual({
      title: 'UN Condemns Assault',
      summary: 'Guterres condemned the attack. More.',
    });
  });

  it('falls back to the raw text when only a link remains', () => {
    expect(splitHeadline('https://t.co/abc').title).toBe('https://t.co/abc');
  });
});

describe('categoryLabel', () => {
  it('humanizes rule tags', () => {
    expect(categoryLabel('brain-fastlane')).toBe('BRAIN FASTLANE');
    expect(categoryLabel(null)).toBe('NEWS');
  });
});

describe('timeAgo', () => {
  const now = Date.UTC(2026, 9, 11, 12);
  it.each([
    [10_000, 'just now'],
    [60_000, '1 minute ago'],
    [14 * 60_000, '14 minutes ago'],
    [3 * 3_600_000, '3 hours ago'],
    [2 * 86_400_000, '2 days ago'],
  ])('%i ms → %s', (age, label) => {
    expect(timeAgo(now - age, now)).toBe(label);
  });

  it('switches to a date after 30 days', () => {
    expect(timeAgo(now - 40 * 86_400_000, now)).toMatch(/2026/);
  });
});

describe('dayLabel', () => {
  it('names today and yesterday', () => {
    const now = new Date(2026, 9, 11, 15).getTime();
    expect(dayLabel(new Date(2026, 9, 11, 1).getTime(), now)).toBe('Today');
    expect(dayLabel(new Date(2026, 9, 10, 23).getTime(), now)).toBe('Yesterday');
  });
});
