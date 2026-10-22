import { defineMessages, intlLocale, type Locale, translate } from '@lib/i18n';

const messages = defineMessages(
  {
    justNow: 'just now',
    minutesAgo_one: '{n} minute ago',
    minutesAgo_other: '{n} minutes ago',
    hoursAgo_one: '{n} hour ago',
    hoursAgo_other: '{n} hours ago',
    daysAgo_one: '{n} day ago',
    daysAgo_other: '{n} days ago',
    today: 'Today',
    yesterday: 'Yesterday',
  },
  {
    justNow: 'justo ahora',
    minutesAgo_one: 'hace {n} minuto',
    minutesAgo_other: 'hace {n} minutos',
    hoursAgo_one: 'hace {n} hora',
    hoursAgo_other: 'hace {n} horas',
    daysAgo_one: 'hace {n} día',
    daysAgo_other: 'hace {n} días',
    today: 'Hoy',
    yesterday: 'Ayer',
  },
);

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

function ago(n: number, unit: 'minutesAgo' | 'hoursAgo' | 'daysAgo', locale: Locale): string {
  return translate(messages, n === 1 ? `${unit}_one` : `${unit}_other`, { n }, locale);
}

export function timeAgo(timestamp: number, now: number, locale: Locale = 'en'): string {
  const delta = Math.max(0, now - timestamp);
  if (delta < MINUTE_MS) return translate(messages, 'justNow', undefined, locale);
  if (delta < HOUR_MS) return ago(Math.floor(delta / MINUTE_MS), 'minutesAgo', locale);
  if (delta < DAY_MS) return ago(Math.floor(delta / HOUR_MS), 'hoursAgo', locale);
  if (delta < 30 * DAY_MS) return ago(Math.floor(delta / DAY_MS), 'daysAgo', locale);
  return new Date(timestamp).toLocaleDateString(intlLocale(locale), {
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

export function dayLabel(timestamp: number, now: number, locale: Locale = 'en'): string {
  const diffDays = Math.round((startOfLocalDay(now) - startOfLocalDay(timestamp)) / DAY_MS);
  if (diffDays === 0) return translate(messages, 'today', undefined, locale);
  if (diffDays === 1) return translate(messages, 'yesterday', undefined, locale);
  const sameYear = new Date(timestamp).getFullYear() === new Date(now).getFullYear();
  return new Date(timestamp).toLocaleDateString(intlLocale(locale), {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

export function dayKey(timestamp: number): number {
  return startOfLocalDay(timestamp);
}
