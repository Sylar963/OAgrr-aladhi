import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { describe, expect, it } from 'vitest';
import { allowedOrigins, trustedProxies } from './security-configuration.js';

describe('security configuration', () => {
  it('does not allow arbitrary preview deployments or production localhost origins', () => {
    const origins = allowedOrigins({ NODE_ENV: 'production', CORS_ALLOWED_ORIGINS: 'https://approved.vercel.app' });
    expect(origins).toContain('https://approved.vercel.app');
    expect(origins).not.toContain('https://attacker.vercel.app');
    expect(origins).not.toContain('http://localhost:5173');
    expect(() => allowedOrigins({ CORS_ALLOWED_ORIGINS: 'https://*.vercel.app' })).toThrow();
  });

  it('rejects universal or malformed trusted proxy configuration', () => {
    for (const value of ['true', '*', '0.0.0.0/0', '::/0', '127.0.0.1/32/0']) {
      expect(() => trustedProxies({ TRUSTED_PROXIES: value })).toThrow();
    }
  });

  it('keeps attacker-supplied forwarded IPs in the same rate-limit bucket', async () => {
    const app = Fastify({ trustProxy: trustedProxies({}) });
    await app.register(rateLimit, { max: 1, timeWindow: '1 minute' });
    app.get('/probe', (req) => ({ ip: req.ip }));
    try {
      const first = await app.inject({ url: '/probe', remoteAddress: '203.0.113.9', headers: { 'x-forwarded-for': '198.51.100.1' } });
      const second = await app.inject({ url: '/probe', remoteAddress: '203.0.113.9', headers: { 'x-forwarded-for': '198.51.100.2' } });
      expect(first.json()).toEqual({ ip: '203.0.113.9' });
      expect(second.statusCode).toBe(429);
    } finally { await app.close(); }
  });

  it('uses the first untrusted hop behind the local reverse proxy', async () => {
    const app = Fastify({ trustProxy: trustedProxies({}) });
    app.get('/probe', (req) => ({ ip: req.ip }));
    try {
      const response = await app.inject({ url: '/probe', remoteAddress: '127.0.0.1', headers: { 'x-forwarded-for': '198.51.100.1, 203.0.113.9' } });
      expect(response.json()).toEqual({ ip: '203.0.113.9' });
    } finally { await app.close(); }
  });
});
