import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { credentialsStoreMock, deriveStoreMock, paradexStoreMock, thalexStoreMock } = vi.hoisted(() => {
  type Env = 'prod' | 'test';
  interface Slot {
    accountId: string;
    venue: string;
    environment: Env;
    active: boolean;
    encryptedCredentials: string;
  }
  // Keyed `${accountId}:${venue}:${environment}`.
  const rows = new Map<string, Slot>();
  const slotsOf = (accountId: string, venue: string) =>
    [...rows.values()].filter((row) => row.accountId === accountId && row.venue === venue);
  const put = (accountId: string, venue: string, environment: Env, encryptedCredentials: string) => {
    for (const row of slotsOf(accountId, venue)) row.active = false;
    rows.set(`${accountId}:${venue}:${environment}`, {
      accountId,
      venue,
      environment,
      active: true,
      encryptedCredentials,
    });
  };
  const thalexState: { env: Env | null } = { env: null };
  return {
    credentialsStoreMock: {
      rows,
      put,
      enabled: true,
      listVenues: vi.fn(async (accountId: string) => [
        ...new Set([...rows.values()].filter((row) => row.accountId === accountId).map((row) => row.venue)),
      ]),
      listSlots: vi.fn(async (accountId: string, venue: string) => slotsOf(accountId, venue)),
      get: vi.fn(async (accountId: string, venue: string, environment?: Env) =>
        slotsOf(accountId, venue).find((row) =>
          environment == null ? row.active : row.environment === environment,
        ) ?? null,
      ),
      upsert: vi.fn(
        async (row: { accountId: string; venue: string; environment?: Env; encryptedCredentials: string }) => {
          put(row.accountId, row.venue, row.environment ?? 'prod', row.encryptedCredentials);
        },
      ),
      activate: vi.fn(async (accountId: string, venue: string, environment: Env) => {
        const target = rows.get(`${accountId}:${venue}:${environment}`);
        if (target == null) return false;
        for (const row of slotsOf(accountId, venue)) row.active = row === target;
        return true;
      }),
      delete: vi.fn(async (accountId: string, venue: string, environment?: Env) => {
        for (const row of slotsOf(accountId, venue)) {
          if (environment == null || row.environment === environment) {
            rows.delete(`${accountId}:${venue}:${row.environment}`);
          }
        }
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
    thalexStoreMock: {
      state: thalexState,
      connect: vi.fn(async (creds: { env?: Env }) => {
        thalexState.env = creds.env ?? 'prod';
      }),
      disconnect: vi.fn(async () => {
        thalexState.env = null;
      }),
      isConnected: () => thalexState.env != null,
      environment: () => thalexState.env,
    },
  };
});

vi.mock('../../trading-services.js', () => ({
  paperTradingStore: { enabled: false },
  venueCredentialsStore: credentialsStoreMock,
}));
vi.mock('../../derive-position-store.js', () => ({ derivePositionStore: deriveStoreMock }));
vi.mock('../../paradex-position-store.js', () => ({ paradexPositionStore: paradexStoreMock }));
vi.mock('../../thalex-position-store.js', () => ({ thalexPositionStore: thalexStoreMock }));
vi.mock('../../portfolio-services.js', () => ({ getOrCreatePortfolioRuntime: vi.fn() }));

import { getVenueCredentialCipher, venueCredentialContext } from '../../venue-credential-cipher.js';
import {
  isMainnetVenueConnected,
  portfolioVenueCredentialsRoute,
  restoreStoredVenue,
} from './venue-credentials.js';

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

    const stored = credentialsStoreMock.rows.get('paper-default:derive:prod')!.encryptedCredentials;
    expect(stored).not.toContain(creds.signerPrivateKey.slice(2));
    expect(getVenueCredentialCipher()!.decrypt(stored, venueCredentialContext('paper-default', 'derive'))).toMatchObject({
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
    credentialsStoreMock.put(
      'paper-default',
      'derive',
      'prod',
      getVenueCredentialCipher()!.encrypt({
        walletAddress: WALLET,
        signerPrivateKey: '0x' + 'b'.repeat(64),
        subaccountId: 1,
      }, venueCredentialContext('paper-default', 'derive')),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/portfolio/venue-credentials/reconnect',
    });

    expect(res.json()).toEqual({ venues: [{ venue: 'derive', configured: false, connected: false }] });
    expect(credentialsStoreMock.rows.has('paper-default:derive:prod')).toBe(false);
    expect(deriveStoreMock.connect).not.toHaveBeenCalled();
  });

  it('does not reconnect with an expired session key', async () => {
    credentialsStoreMock.put(
      'paper-default',
      'derive',
      'prod',
      getVenueCredentialCipher()!.encrypt({
        walletAddress: WALLET,
        sessionPrivateKey: '0x' + 'c'.repeat(64),
        publicSessionKey: '0x' + 'd'.repeat(40),
        subaccountId: 1,
        expirySec: Math.floor(Date.now() / 1000) - 60,
      }, venueCredentialContext('paper-default', 'derive')),
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
    const stored = credentialsStoreMock.rows.get('paper-default:paradex:prod')!.encryptedCredentials;
    expect(stored).not.toContain(readonlyToken);
    expect(getVenueCredentialCipher()!.decrypt(stored, venueCredentialContext('paper-default', 'paradex'))).toEqual({
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

describe('Thalex key slots per environment', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const ACCT = 'paper-default';
  const MAINNET = { kid: 'kid-main-9f3c', privateKeyPem: 'MAIN-PEM' };
  const TESTNET = { kid: 'kid-test-a1b2', privateKeyPem: 'TEST-PEM', account: 'A0001' };

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
    thalexStoreMock.state.env = null;
    thalexStoreMock.connect.mockClear();
    thalexStoreMock.disconnect.mockClear();
  });

  async function saveMainnet() {
    const res = await app.inject({
      method: 'POST',
      url: '/portfolio/venue-credentials/thalex',
      payload: MAINNET,
    });
    expect(res.statusCode).toBe(200);
  }

  it('saves a testnet key in its own slot, bound to the testnet context, and switches to it', async () => {
    await saveMainnet();
    const res = await app.inject({
      method: 'POST',
      url: '/portfolio/venue-credentials/thalex',
      payload: { ...TESTNET, env: 'test' },
    });

    expect(res.statusCode).toBe(200);
    expect(thalexStoreMock.connect).toHaveBeenLastCalledWith(
      expect.objectContaining({ kid: TESTNET.kid, account: 'A0001', env: 'test' }),
    );
    const test = credentialsStoreMock.rows.get(`${ACCT}:thalex:test`)!;
    const prod = credentialsStoreMock.rows.get(`${ACCT}:thalex:prod`)!;
    expect(test.active).toBe(true);
    expect(prod.active).toBe(false);
    const cipher = getVenueCredentialCipher()!;
    expect(cipher.decrypt(test.encryptedCredentials, venueCredentialContext(ACCT, 'thalex', 'test'))).toMatchObject({
      kid: TESTNET.kid,
      env: 'test',
    });
    expect(() => cipher.decrypt(test.encryptedCredentials, venueCredentialContext(ACCT, 'thalex'))).toThrow();
  });

  it('lists both environments with which one is in use, never the key itself', async () => {
    await saveMainnet();

    const res = await app.inject({ method: 'GET', url: '/portfolio/venue-credentials/thalex/keys' });

    expect(res.json()).toEqual({
      venue: 'thalex',
      slots: [
        { environment: 'prod', configured: true, active: true, connected: true, kidHint: '9f3c', account: null },
        { environment: 'test', configured: false, active: false, connected: false, kidHint: null, account: null },
      ],
    });
    expect(res.body).not.toContain('MAIN-PEM');
  });

  it('switches the portfolio between saved environments', async () => {
    await saveMainnet();
    await app.inject({
      method: 'POST',
      url: '/portfolio/venue-credentials/thalex',
      payload: { ...TESTNET, env: 'test' },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/portfolio/venue-credentials/thalex/activate',
      payload: { environment: 'prod' },
    });

    expect(res.statusCode).toBe(200);
    expect(thalexStoreMock.connect).toHaveBeenLastCalledWith(
      expect.objectContaining({ kid: MAINNET.kid, env: 'prod' }),
    );
    expect(res.json().slots.map((slot: { environment: string; active: boolean }) => [slot.environment, slot.active])).toEqual([
      ['prod', true],
      ['test', false],
    ]);
  });

  it('refuses to switch to an environment with no saved key', async () => {
    await saveMainnet();
    thalexStoreMock.connect.mockClear();

    const res = await app.inject({
      method: 'POST',
      url: '/portfolio/venue-credentials/thalex/activate',
      payload: { environment: 'test' },
    });

    expect(res.statusCode).toBe(404);
    expect(thalexStoreMock.connect).not.toHaveBeenCalled();
    expect(thalexStoreMock.state.env).toBe('prod');
  });

  it('keeps the mainnet session when a testnet key is rejected', async () => {
    await saveMainnet();
    thalexStoreMock.connect.mockImplementationOnce(async () => {
      throw new Error('login failed');
    });

    const res = await app.inject({
      method: 'POST',
      url: '/portfolio/venue-credentials/thalex',
      payload: { ...TESTNET, env: 'test' },
    });

    expect(res.statusCode).toBe(502);
    expect(credentialsStoreMock.rows.has(`${ACCT}:thalex:test`)).toBe(false);
    expect(thalexStoreMock.connect).toHaveBeenLastCalledWith(
      expect.objectContaining({ kid: MAINNET.kid, env: 'prod' }),
    );
    expect(thalexStoreMock.state.env).toBe('prod');
  });

  it('removing the unused testnet slot leaves the mainnet session alone', async () => {
    await saveMainnet();
    credentialsStoreMock.put(ACCT, 'thalex', 'test', 'unused');
    await credentialsStoreMock.activate(ACCT, 'thalex', 'prod');
    thalexStoreMock.disconnect.mockClear();

    const res = await app.inject({
      method: 'DELETE',
      url: '/portfolio/venue-credentials/thalex?environment=test',
    });

    expect(res.json()).toEqual({ venue: 'thalex', connected: true, configured: true });
    expect(thalexStoreMock.disconnect).not.toHaveBeenCalled();
    expect(credentialsStoreMock.rows.has(`${ACCT}:thalex:prod`)).toBe(true);
  });

  it('rejects an unknown environment on delete', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/portfolio/venue-credentials/thalex?environment=staging',
    });
    expect(res.statusCode).toBe(400);
  });

  it('reconnects with the active slot and its environment', async () => {
    credentialsStoreMock.put(
      ACCT,
      'thalex',
      'test',
      getVenueCredentialCipher()!.encrypt(TESTNET, venueCredentialContext(ACCT, 'thalex', 'test')),
    );

    const res = await app.inject({ method: 'POST', url: '/portfolio/venue-credentials/reconnect' });

    expect(res.json()).toEqual({ venues: [{ venue: 'thalex', configured: true, connected: true }] });
    expect(thalexStoreMock.connect).toHaveBeenCalledWith(expect.objectContaining({ env: 'test' }));
  });

  it('never restores or reports a testnet session for other users to see', async () => {
    credentialsStoreMock.put(
      ACCT,
      'thalex',
      'test',
      getVenueCredentialCipher()!.encrypt(TESTNET, venueCredentialContext(ACCT, 'thalex', 'test')),
    );

    expect(await restoreStoredVenue(ACCT, 'thalex')).toBe('not_connected');
    expect(thalexStoreMock.connect).not.toHaveBeenCalled();

    thalexStoreMock.state.env = 'test';
    expect(isMainnetVenueConnected(ACCT, 'thalex')).toBe(false);
    thalexStoreMock.state.env = 'prod';
    expect(isMainnetVenueConnected(ACCT, 'thalex')).toBe(true);
  });
});
