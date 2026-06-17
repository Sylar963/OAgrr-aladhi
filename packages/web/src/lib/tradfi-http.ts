const TRADFI_BASE = import.meta.env.VITE_TRADFI_API_BASE ?? '/tradfi-api';
const RETRY_DELAY_MS = 1500;
const MAX_RETRIES = 8;

export async function tradfiFetchJson<T>(path: string): Promise<T> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${TRADFI_BASE}${path}`);
      if (res.status === 503) {
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          continue;
        }
        throw new Error('TradFi service still initializing');
      }
      if (!res.ok) throw new Error(`TradFi API error: ${res.status} ${res.statusText}`);
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

export function tradfiWsUrl(path: string): string {
  const wsOverride = import.meta.env.VITE_TRADFI_WS_URL;
  if (wsOverride) return `${wsOverride.replace(/\/$/, '')}${path}`;
  const raw = import.meta.env.VITE_TRADFI_API_BASE;
  if (raw && /^https?:\/\//i.test(raw)) {
    const u = new URL(raw);
    const proto = u.protocol === 'https:' ? 'wss:' : 'ws:';
    const basePath = u.pathname.replace(/\/$/, '');
    return `${proto}//${u.host}${basePath}${path}`;
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const base = (raw || '/tradfi-api').replace(/\/$/, '');
  return `${proto}//${window.location.host}${base}${path}`;
}
