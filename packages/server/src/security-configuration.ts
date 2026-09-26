import { isIP } from 'node:net';

export function trustedProxies(env: NodeJS.ProcessEnv): string[] {
  const values = (env['TRUSTED_PROXIES'] ?? '127.0.0.1,::1').split(',').map((v) => v.trim()).filter(Boolean);
  for (const value of values) {
    const [address, prefix] = value.split('/');
    const version = isIP(address ?? '');
    if (!version || value.split('/').length > 2 || (prefix !== undefined && (!/^\d+$/.test(prefix) || Number(prefix) < 1 || Number(prefix) > (version === 4 ? 32 : 128)))) {
      throw new Error('TRUSTED_PROXIES must contain explicit IP addresses or non-universal CIDRs');
    }
  }
  return values;
}

export function allowedOrigins(env: NodeJS.ProcessEnv): string[] {
  const origins = [
    'https://oggregator.xyz',
    'https://www.oggregator.xyz',
    'https://app.oggregator.xyz',
    ...(env['NODE_ENV'] === 'production' ? [] : ['http://localhost:5173', 'http://127.0.0.1:5173']),
    ...(env['CORS_ALLOWED_ORIGINS'] ?? '').split(',').map((v) => v.trim()).filter(Boolean),
  ];
  for (const origin of origins) {
    const url = new URL(origin);
    if (!['https:', 'http:'].includes(url.protocol) || url.origin !== origin || origin.includes('*')) {
      throw new Error('CORS_ALLOWED_ORIGINS must contain exact HTTP(S) origins');
    }
  }
  return [...new Set(origins)];
}

export const reportOnlyCsp = {
  reportOnly: true,
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", 'https://*.clerk.accounts.dev', 'https://clerk.oggregator.xyz', 'https://va.vercel-scripts.com'],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
    fontSrc: ["'self'", 'data:'],
    connectSrc: ["'self'", 'https://*.oggregator.xyz', 'wss://*.oggregator.xyz', 'https://*.clerk.accounts.dev', 'https://*.vercel-insights.com'],
    workerSrc: ["'self'", 'blob:'],
    frameSrc: ["'self'", 'https://*.clerk.accounts.dev', 'https://challenges.cloudflare.com'],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    frameAncestors: ["'none'"],
  },
};
