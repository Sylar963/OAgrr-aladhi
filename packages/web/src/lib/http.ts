import { getClerkToken } from '@lib/clerk-token';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api';
const RETRY_DELAY_MS = 1500;
const MAX_RETRIES = 10;
// Transient gateway errors (proxy/server restart, upstream blip, rate limit).
// fetchJson is GET-only, so retrying these is idempotent. Capped small so a
// genuinely-down upstream surfaces in a few seconds, not the 503 path's 15s.
const MAX_GATEWAY_RETRIES = 3;
const GATEWAY_RETRY_STATUSES = new Set([502, 504, 429]);

function retryDelayFor(res: Response): number {
  const header = res.headers.get('Retry-After');
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) {
      // Honor Retry-After but clamp so a hostile/large value can't stall the UI.
      return Math.min(seconds * 1000, RETRY_DELAY_MS * 4);
    }
  }
  return RETRY_DELAY_MS;
}

export function wsUrl(path: string): string {
  const raw = import.meta.env.VITE_API_BASE_URL;
  if (raw && /^https?:\/\//i.test(raw)) {
    const u = new URL(raw);
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    u.pathname = path;
    u.search = '';
    return u.toString();
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}${path}`;
}

async function getHeaders(): Promise<HeadersInit> {
  const headers: HeadersInit = {};
  const token = await getClerkToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

export async function fetchJson<T>(
  path: string,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  let gatewayAttempts = 0;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        headers: { ...(await getHeaders()), ...extraHeaders },
      });

      if (res.status === 503) {
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          continue;
        }
        throw new Error('Server still initializing');
      }

      if (GATEWAY_RETRY_STATUSES.has(res.status)) {
        if (gatewayAttempts < MAX_GATEWAY_RETRIES) {
          gatewayAttempts++;
          await new Promise((r) => setTimeout(r, retryDelayFor(res)));
          continue;
        }
        throw new Error(`API error: ${res.status} ${res.statusText}`);
      }

      if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
      return res.json() as Promise<T>;
    } catch (err) {
      if (attempt < MAX_RETRIES && err instanceof TypeError) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        continue;
      }
      throw err;
    }
  }

  throw new Error('Max retries exceeded');
}
