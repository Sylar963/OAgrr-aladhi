import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { cspReportRoute, parseCspReports } from './csp-report.js';

describe('parseCspReports', () => {
  it('reads the legacy report-uri body, keeping only path and origin', () => {
    expect(
      parseCspReports({
        'csp-report': {
          'document-uri': 'https://app.oggregator.xyz/portfolio?token=secret#frag',
          'violated-directive': 'script-src-elem',
          'blocked-uri': 'https://evil.example/x.js?k=1',
          disposition: 'report',
        },
      }),
    ).toEqual([
      {
        page: 'https://app.oggregator.xyz/portfolio',
        directive: 'script-src-elem',
        blocked: 'https://evil.example',
        disposition: 'report',
      },
    ]);
  });

  it('reads Reporting API batches and ignores other report types', () => {
    expect(
      parseCspReports([
        {
          type: 'csp-violation',
          body: { documentURL: 'https://app.oggregator.xyz/', effectiveDirective: 'connect-src', blockedURL: 'wss://x.example/ws', disposition: 'report' },
        },
        { type: 'deprecation', body: {} },
      ]),
    ).toEqual([
      { page: 'https://app.oggregator.xyz/', directive: 'connect-src', blocked: 'wss://x.example', disposition: 'report' },
    ]);
  });

  it('keeps keyword sources and ignores junk', () => {
    expect(parseCspReports({ 'csp-report': { 'blocked-uri': 'inline' } })[0]?.blocked).toBe('inline');
    expect(parseCspReports('nonsense')).toEqual([]);
    expect(parseCspReports(null)).toEqual([]);
  });
});

describe('POST /api/csp-report', () => {
  async function app(warn = vi.fn()) {
    const instance = Fastify({ logger: false });
    instance.addHook('onRequest', async (request) => {
      request.log.warn = warn as never;
    });
    await instance.register(cspReportRoute, { prefix: '/api' });
    await instance.ready();
    return instance;
  }

  it('accepts both report content types, logs, and returns nothing', async () => {
    const warn = vi.fn();
    const server = await app(warn);
    for (const [type, body] of [
      ['application/csp-report', { 'csp-report': { 'violated-directive': 'img-src' } }],
      ['application/reports+json', [{ type: 'csp-violation', body: { effectiveDirective: 'img-src' } }]],
    ] as const) {
      const res = await server.inject({
        method: 'POST',
        url: '/api/csp-report',
        headers: { 'content-type': type },
        payload: JSON.stringify(body),
      });
      expect(res.statusCode).toBe(204);
      expect(res.body).toBe('');
    }
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('rejects oversized bodies', async () => {
    const server = await app();
    const res = await server.inject({
      method: 'POST',
      url: '/api/csp-report',
      headers: { 'content-type': 'application/csp-report' },
      payload: JSON.stringify({ 'csp-report': { 'blocked-uri': 'x'.repeat(20_000) } }),
    });
    expect(res.statusCode).toBe(413);
  });
});
