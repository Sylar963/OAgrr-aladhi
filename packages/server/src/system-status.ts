import { readFileSync } from 'node:fs';
import { SystemAnnouncementSchema, type SystemAnnouncement } from '@oggregator/protocol';

const CACHE_TTL_MS = 5_000;

let cache: { value: SystemAnnouncement | null; at: number } | null = null;

/**
 * Operator-controlled status flag. Reads + validates the JSON file at
 * $STATUS_FILE, cached for 5s so /health stays cheap. Never throws — a
 * missing/invalid file means "no announcement".
 */
export function getSystemAnnouncement(now: number = Date.now()): SystemAnnouncement | null {
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.value;
  const value = readStatusFile();
  cache = { value, at: now };
  return value;
}

function readStatusFile(): SystemAnnouncement | null {
  const path = process.env['STATUS_FILE'];
  if (!path) return null;

  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return null; // missing / unreadable → no announcement
  }

  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === 'null') return null; // empty file or bare "null" is the operator's way to clear the announcement

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    console.warn('[system-status] STATUS_FILE is not valid JSON; ignoring');
    return null;
  }

  const result = SystemAnnouncementSchema.safeParse(parsed);
  if (!result.success) {
    console.warn('[system-status] STATUS_FILE failed schema validation; ignoring');
    return null;
  }
  return result.data;
}

/** Test-only: clear the in-memory cache. */
export function __resetSystemStatusCache(): void {
  cache = null;
}
