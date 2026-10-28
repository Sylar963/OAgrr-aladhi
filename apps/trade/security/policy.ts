/**
 * The vault's security headers, in one place. `vercel.json` must match these exactly (a test
 * enforces it), the build embeds the CSP as a <meta> tag as a fallback, and the browser check
 * serves the build with them. Widening any of this needs a spec change (B0/B1 §3.2).
 */

/** Venue endpoints the vault may open sockets to. Add Derive in B4, nothing else. */
export const VENUE_ENDPOINTS = ['wss://testnet.thalex.com', 'wss://thalex.com'] as const;

export const CSP_DIRECTIVES: ReadonlyArray<readonly [string, ...string[]]> = [
  ['default-src', "'none'"],
  ['script-src', "'self'"],
  ['style-src', "'self'"],
  ['img-src', "'self'", 'data:'],
  ['font-src', "'self'"],
  ['connect-src', "'self'", ...VENUE_ENDPOINTS],
  ['manifest-src', "'self'"],
  ['base-uri', "'none'"],
  ['form-action', "'none'"],
  ['frame-ancestors', "'none'"],
  ['object-src', "'none'"],
  ['worker-src', "'none'"],
  ['require-trusted-types-for', "'script'"],
  ['trusted-types', "'none'"],
  ['upgrade-insecure-requests'],
];

/** Directives browsers ignore in a <meta> policy; they must come from the header. */
const HEADER_ONLY = new Set(['frame-ancestors', 'report-uri', 'report-to', 'sandbox']);

export function cspHeader(): string {
  return CSP_DIRECTIVES.map((directive) => directive.join(' ')).join('; ');
}

export function cspMeta(): string {
  return CSP_DIRECTIVES.filter(([name]) => !HEADER_ONLY.has(name))
    .map((directive) => directive.join(' '))
    .join('; ');
}

export const SECURITY_HEADERS: ReadonlyArray<{ key: string; value: string }> = [
  { key: 'Content-Security-Policy', value: cspHeader() },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  {
    key: 'Permissions-Policy',
    value:
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), clipboard-read=()',
  },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
];
