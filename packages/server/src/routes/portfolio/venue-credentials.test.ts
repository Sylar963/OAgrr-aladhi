import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { credentialsStoreMock, deriveStoreMock, paradexStoreMock } = vi.hoisted(() => {
  const rows = new Map<string, string>();
  return {
    credentialsStoreMock: {
      rows,
      enabled: true,
      listVenues: vi.fn(async (accountId: string) =>
        [...rows.keys()].filter((key) => key.startsWith(`${accountId}:`)).map((key) => key.split(':')[1]!),
      ),
      get: vi.fn(async (accountId: string, venue: string) => {
        const encryptedCredentials = rows.get(`${accountId}:${venue}`);
        return encryptedCredentials == null ? null : { accountId, venue, encryptedCredentials };
      }),
      upsert: vi.fn(
        async (row: { accountId: string; venue: string; encryptedCredentials: string }) => {
          rows.set(`${row.accountId}:${row.venue}`, row.encryptedCredentials);
        },
      ),
      delete: vi.fn(async (accountId: string, venue: string) => {
        rows.delete(`${accountId}:${venue}`);
      }),
    },
    deriveStoreMock: {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      isConnected: vi.fn(() => false),
    },
    paradexStoreMock: {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      isConnected: vi.fn(() => false),
    },
  };
});

vi.mock('../../trading-services.js', () => ({
  paperTradingStore: { enabled: false },
  venueCredentialsStore: credentialsStoreMock,
}));
vi.mock('../../derive-position-store.js', () => ({ derivePositionStore: deriveStoreMock }));
vi.mock('../../paradex-position-store.js', () => ({ paradexPositionStore: paradexStoreMock }));
vi.mock('../../thalex-position-store.js', () => ({
  thalexPositionStore: {
    connect: vi.fn(),
    disconnect: vi.fn().mockResolvedValue(undefined),
    isConnected: () => false,
  },
}));
vi.mock('../../portfolio-services.js', () => ({ getOrCreatePortfolioRuntime: vi.fn() }));

import { getVenueCredentialCipher } from '../../venue-credential-cipher.js';
import { portfolioVenueCredentialsRoute } from './venue-credentials.js';

const WALLET = '0x' + 'a'.repeat(40);

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(portfolioVenueCredentialsRoute);
  await app.ready();
  return app;
}

describe('Derive wallet-connect credential routes', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    vi.stubEnv('PRIVATE_VENUE_ADAPTERS_ENABLED', 'true');
    vi.stubEnv('VENUE_CREDENTIALS_ENCRYPTION_KEY', Buffer.alloc(32, 9).toString('base64'));
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    credentialsStoreMock.rows.clear();
    deriveStoreMock.connect.mockReset().mockResolvedValue(undefined);
  });

  it('rejects a pasted Derive key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/portfolio/venue-credentials/derive',
      payload: { walletAddress: WALLET, signerPrivateKey: '0x' + 'b'.repeat(64), subaccountId: 1 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'wallet_connect_required' });
    expect(deriveStoreMock.connect).not.toHaveBeenCalled();
  });

  it('issues a public session key and never returns its private half', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/portfolio/venue-credentials/derive/session-key',
    });
    expect(res.statusCode).toBe(200);
    const grant = res.json();
    expect(grant.publicSessionKey).toMatch(/^0x[0-9a-f]{40}$/);
    expect(grant.expirySec).toBeGreaterThan(Date.now() / 1000);
    expect(JSON.stringify(grant)).not.toMatch(/[0-9a-f]{64}/);
  });

  it('confirms the issued key, connects with it and stores it encrypted', async () => {
    const grant = (
      await app.inject({ method: 'POST', url: '/portfolio/venue-credentials/derive/session-key' })
    ).json();

    const res = await app.inject({
      method: 'POST',
      url: '/portfolio/venue-credentials/derive/session-key/confirm',
      payload: { walletAddress: WALLET, subaccountId: 7 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ venue: 'derive', connected: true, configured: true });
    const creds = deriveStoreMock.connect.mock.calls[0]![0];
    expect(creds).toMatchObject({ walletAddress: WALLET, subaccountId: 7 });
    expect(creds.signerPrivateKey).toMatch(/^0x[0-9a-f]{64}$/);

    const stored = credentialsStoreMock.rows.get('paper-default:derive')!;
    expect(stored).not.toContain(creds.signerPrivateKey.slice(2));
    expect(getVenueCredentialCipher()!.decrypt(stored)).toMatchObject({
      publicSessionKey: grant.publicSessionKey,
      expirySec: grant.expirySec,
    });

    const replay = await app.inject({
      method: 'POST',
      url: '/portfolio/venue-credentials/derive/session-key/confirm',
      payload: { walletAddress: WALLET, subaccountId: 7 },
    });
    expect(replay.statusCode).toBe(409);
  });

  it('keeps nothing when Derive rejects the session key', async () => {
    await app.inject({ method: 'POST', url: '/portfolio/venue-credentials/derive/session-key' });
    deriveStoreMock.connect.mockRejectedValueOnce(new Error('login failed'));

    const res = await app.inject({
      method: 'POST',
      url: '/portfolio/venue-credentials/derive/session-key/confirm',
      payload: { walletAddress: WALLET, subaccountId: 7 },
    });

    expect(res.statusCode).toBe(502);
    expect(credentialsStoreMock.rows.size).toBe(0);
  });

  it('wipes a legacy pasted-key row instead of reconnecting with it', async () => {
    credentialsStoreMock.rows.set(
      'paper-default:derive',
      getVenueCredentialCipher()!.encrypt({
        walletAddress: WALLET,
        signerPrivateKey: '0x' + 'b'.repeat(64),
        subaccountId: 1,
      }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/portfolio/venue-credentials/reconnect',
    });

    expect(res.json()).toEqual({ venues: [{ venue: 'derive', configured: false, connected: false }] });
    expect(credentialsStoreMock.rows.has('paper-default:derive')).toBe(false);
    expect(deriveStoreMock.connect).not.toHaveBeenCalled();
  });

  it('does not reconnect with an expired session key', async () => {
    credentialsStoreMock.rows.set(
      'paper-default:derive',
      getVenueCredentialCipher()!.encrypt({
        walletAddress: WALLET,
        sessionPrivateKey: '0x' + 'c'.repeat(64),
        publicSessionKey: '0x' + 'd'.repeat(40),
        subaccountId: 1,
        expirySec: Math.floor(Date.now() / 1000) - 60,
      }),
    );

    const res = await app.inject({ method: 'POST', url: '/portfolio/venue-credentials/reconnect' });

    expect(res.json()).toEqual({ venues: [{ venue: 'derive', configured: true, connected: false }] });
    expect(deriveStoreMock.connect).not.toHaveBeenCalled();
  });
});

function paradexToken(claims: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'ES384' })}.${encode(claims)}.c2ln`;
}

describe('Paradex read-only key routes', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const ACCOUNT = '0x43a5c62f23af2e5f90cf390e71914ac1847b48aa728c4f4baf6acbbef876262';

  beforeAll(async () => {
    vi.stubEnv('PRIVATE_VENUE_ADAPTERS_ENABLED', 'true');
    vi.stubEnv('VENUE_CREDENTIALS_ENCRYPTION_KEY', Buffer.alloc(32, 9).toString('base64'));
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    credentialsStoreMock.rows.clear();
    paradexStoreMock.connect.mockReset().mockResolvedValue(undefined);
  });

  it('serves the token settings the browser should request', async () => {
    vi.stubEnv('PARADEX_READONLY_TOKEN_TTL_DAYS', '30');
    vi.stubEnv('PARADEX_READONLY_TOKEN_ALLOWED_CIDRS', '203.0.113.7/32');
    const res = await app.inject({
      method: 'GET',
      url: '/portfolio/venue-credentials/paradex/token-settings',
    });
    expect(res.json()).toEqual({
      name: 'oggregator read-only',
      expiryDurationSec: 30 * 86_400,
      allowedCidrs: ['203.0.113.7/32'],
    });
  });

  it('connects with a read-only key and stores it encrypted with its account and expiry', async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const readonlyToken = paradexToken({ sub: ACCOUNT, exp });

    const res = await app.inject({
      method: 'POST',
      url: '/portfolio/venue-credentials/paradex',
      payload: { readonlyToken },
    });

    expect(res.statusCode).toBe(200);
    expect(paradexStoreMock.connect).toHaveBeenCalledWith({ accountId: 'paper-default', readonlyToken });
    const stored = credentialsStoreMock.rows.get('paper-default:paradex')!;
    expect(stored).not.toContain(readonlyToken);
    expect(getVenueCredentialCipher()!.decrypt(stored)).toEqual({
      readonlyToken,
      account: ACCOUNT,
      expiresAtMs: exp * 1000,
    });
  });

  it('rejects an expired or malformed key without contacting Paradex', async () => {
    for (const readonlyToken of [
      paradexToken({ sub: ACCOUNT, exp: Math.floor(Date.now() / 1000) - 1 }),
      paradexToken({ exp: 1 }),
    ]) {
      const res = await app.inject({
        method: 'POST',
        url: '/portfolio/venue-credentials/paradex',
        payload: { readonlyToken },
      });
      expect(res.statusCode).toBe(400);
    }
    expect(paradexStoreMock.connect).not.toHaveBeenCalled();
  });

  it('stores nothing when Paradex rejects the key', async () => {
    paradexStoreMock.connect.mockRejectedValueOnce(new Error('HTTP 401'));
    const res = await app.inject({
      method: 'POST',
      url: '/portfolio/venue-credentials/paradex',
      payload: { readonlyToken: paradexToken({ sub: ACCOUNT, exp: Math.floor(Date.now() / 1000) + 60 }) },
    });
    expect(res.statusCode).toBe(502);
    expect(credentialsStoreMock.rows.size).toBe(0);
  });
});
