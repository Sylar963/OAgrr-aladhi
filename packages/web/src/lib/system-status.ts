import {
  type SystemAnnouncement,
  SystemAnnouncementSchema,
  type SystemAnnouncementSeverity,
} from '@oggregator/protocol';

const DISMISSED_KEY = 'systemAnnouncementDismissed';

export const SEVERITY_ICON: Record<SystemAnnouncementSeverity, string> = {
  info: 'ℹ',
  notice: '⚠',
  degraded: '◍',
  outage: '⛔',
};

const SEVERITY_RANK: Record<SystemAnnouncementSeverity, number> = {
  info: 1,
  notice: 2,
  degraded: 3,
  outage: 4,
};

/** Severities that re-show even after the user dismissed an earlier id. */
const ALWAYS_SHOW: ReadonlySet<SystemAnnouncementSeverity> = new Set(['degraded', 'outage']);

export function parseAnnouncement(raw: unknown): SystemAnnouncement | null {
  if (raw == null) return null;
  const result = SystemAnnouncementSchema.safeParse(raw);
  return result.success ? result.data : null;
}

export function loadDismissedIds(): string[] {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function addDismissedId(id: string): string[] {
  const next = Array.from(new Set([...loadDismissedIds(), id]));
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota / unavailable storage */
  }
  return next;
}

export interface ActiveNotice {
  /** announcement id, or null for the synthesized feed-degraded notice. */
  id: string | null;
  severity: SystemAnnouncementSeverity;
  title: string;
  message?: string;
  startsAt?: number;
  endsAt?: number;
  dismissible: boolean;
}

export interface NoticeSelection {
  surface: 'takeover' | 'banner' | null;
  notice: ActiveNotice | null;
}

const FEED_DEGRADED_NOTICE: ActiveNotice = {
  id: null,
  severity: 'degraded',
  title: 'Live feed disconnected',
  message: 'Reconnecting to market data…',
  dismissible: false,
};

/** Pure decision: which surface (if any) to render right now. */
export function selectActiveNotice(
  announcement: SystemAnnouncement | null,
  feedDegraded: boolean,
  dismissedIds: readonly string[],
  now: number,
): NoticeSelection {
  const candidates: Array<{ surface: 'takeover' | 'banner'; notice: ActiveNotice }> = [];

  if (announcement) {
    const expired = announcement.endsAt != null && announcement.endsAt <= now;
    const dismissed =
      dismissedIds.includes(announcement.id) && !ALWAYS_SHOW.has(announcement.severity);
    if (!expired && !dismissed) {
      // Two independent axes: ALWAYS_SHOW controls re-showing after a dismiss;
      // `dismissible` controls whether a dismiss button appears at all. An
      // operator may set dismissible:true even on degraded/outage.
      const dismissible = announcement.dismissible ?? !ALWAYS_SHOW.has(announcement.severity);
      candidates.push({
        surface: announcement.blocking ? 'takeover' : 'banner',
        notice: {
          id: announcement.id,
          severity: announcement.severity,
          title: announcement.title,
          message: announcement.message,
          startsAt: announcement.startsAt,
          endsAt: announcement.endsAt,
          dismissible,
        },
      });
    }
  }

  if (feedDegraded) {
    candidates.push({ surface: 'banner', notice: FEED_DEGRADED_NOTICE });
  }

  if (candidates.length === 0) return { surface: null, notice: null };

  const takeover = candidates.find((c) => c.surface === 'takeover');
  if (takeover) return takeover;

  return candidates.reduce((a, b) =>
    SEVERITY_RANK[b.notice.severity] > SEVERITY_RANK[a.notice.severity] ? b : a,
  );
}
