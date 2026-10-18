const TCO_LINK = /https?:\/\/t\.co\/\S+/gi;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export interface Headline {
  title: string;
  summary: string | null;
}

// Tweets carry trailing t.co links (often duplicated) and sometimes a second paragraph; the first
// line reads as the headline and the remainder as a summary.
export function splitHeadline(text: string): Headline {
  const lines = text
    .replace(TCO_LINK, '')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0);
  const [title = text.trim(), ...rest] = lines;
  const summary = rest.join(' ');
  return { title, summary: summary.length > 0 ? summary : null };
}

export function categoryLabel(ruleTag: string | null): string {
  return (ruleTag ?? 'news').replace(/[_-]+/g, ' ').toUpperCase();
}

// The upstream rule tag is the same for nearly every headline, so the strongest relevance tag says
// more when there is one.
export function headlineLabel(item: {
  ruleTag: string | null;
  relevance?: { tags: string[] } | undefined;
}): string {
  return categoryLabel(item.relevance?.tags[0] ?? item.ruleTag);
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'} ago`;
}

export function timeAgo(timestamp: number, now: number): string {
  const delta = Math.max(0, now - timestamp);
  if (delta < MINUTE_MS) return 'just now';
  if (delta < HOUR_MS) return plural(Math.floor(delta / MINUTE_MS), 'minute');
  if (delta < DAY_MS) return plural(Math.floor(delta / HOUR_MS), 'hour');
  if (delta < 30 * DAY_MS) return plural(Math.floor(delta / DAY_MS), 'day');
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function clockTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function dayLabel(timestamp: number, now: number): string {
  const diffDays = Math.round((startOfLocalDay(now) - startOfLocalDay(timestamp)) / DAY_MS);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  const sameYear = new Date(timestamp).getFullYear() === new Date(now).getFullYear();
  return new Date(timestamp).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

export function dayKey(timestamp: number): number {
  return startOfLocalDay(timestamp);
}
