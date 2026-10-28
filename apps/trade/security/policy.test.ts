import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CSP_DIRECTIVES, cspHeader, cspMeta, SECURITY_HEADERS, VENUE_ENDPOINTS } from './policy';

interface VercelConfig {
  headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
}

const vercel = JSON.parse(
  readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'),
) as VercelConfig;

function directive(name: string): string[] {
  return CSP_DIRECTIVES.find(([key]) => key === name)?.slice(1) ?? [];
}

describe('vault security policy', () => {
  it('ships exactly these headers on every path', () => {
    expect(vercel.headers).toEqual([{ source: '/(.*)', headers: SECURITY_HEADERS }]);
  });

  it('is enforced, never report-only', () => {
    const keys = SECURITY_HEADERS.map((h) => h.key);
    expect(keys).toContain('Content-Security-Policy');
    expect(keys.some((k) => /report-only/i.test(k))).toBe(false);
  });

  it('allows only our own scripts and styles, with no unsafe escapes or wildcards', () => {
    const csp = cspHeader();
    expect(csp).not.toMatch(/unsafe-|\*|blob:|http:/);
    expect(directive('script-src')).toEqual(["'self'"]);
    expect(directive('style-src')).toEqual(["'self'"]);
    expect(directive('default-src')).toEqual(["'none'"]);
    expect(directive('object-src')).toEqual(["'none'"]);
    expect(directive('base-uri')).toEqual(["'none'"]);
    expect(directive('form-action')).toEqual(["'none'"]);
    expect(directive('worker-src')).toEqual(["'none'"]);
  });

  it('only connects to the listed venue endpoints', () => {
    expect(directive('connect-src')).toEqual(["'self'", ...VENUE_ENDPOINTS]);
    expect([...VENUE_ENDPOINTS]).toEqual(['wss://testnet.thalex.com', 'wss://thalex.com']);
  });

  it('cannot be framed, scripted from another window, or fed HTML strings', () => {
    expect(directive('frame-ancestors')).toEqual(["'none'"]);
    expect(directive('require-trusted-types-for')).toEqual(["'script'"]);
    expect(directive('trusted-types')).toEqual(["'none'"]);
    const header = (key: string) => SECURITY_HEADERS.find((h) => h.key === key)?.value;
    expect(header('Cross-Origin-Opener-Policy')).toBe('same-origin');
    expect(header('Cross-Origin-Embedder-Policy')).toBe('require-corp');
    expect(header('X-Frame-Options')).toBe('DENY');
    expect(header('Referrer-Policy')).toBe('no-referrer');
  });

  it('keeps header-only directives out of the meta fallback', () => {
    expect(cspMeta()).not.toContain('frame-ancestors');
    expect(cspMeta()).toContain("script-src 'self'");
  });
});
