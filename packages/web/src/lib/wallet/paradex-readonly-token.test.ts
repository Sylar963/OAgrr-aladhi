import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildParadexSiweAuthMessage,
  createParadexReadonlyToken,
  lookupParadexEvmAccount,
  PARADEX_PROD,
  paradexEvmAuth,
} from './paradex-readonly-token';

const ADDRESS = '0x8ba1f109551bd432803012645ac136ddd64dba72';

function respond(status: number, body: unknown) {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

describe('buildParadexSiweAuthMessage', () => {
  it('matches the paradex-py EvmAccount auth message byte for byte', () => {
    expect(
      buildParadexSiweAuthMessage({
        env: PARADEX_PROD,
        address: ADDRESS,
        nonce: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
        nowMs: Date.UTC(2026, 9, 11, 12, 30, 45, 678),
      }),
    ).toBe(
      [
        'app.paradex.trade wants you to sign in with your Ethereum account:',
        '0x8ba1f109551bD432803012645Ac136ddd64DBA72',
        '',
        'Paradex Auth',
        '',
        'URI: https://app.paradex.trade',
        'Version: 1',
        'Chain ID: 1',
        'Nonce: a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
        'Issued At: 2026-10-11T12:30:45Z',
        'Expiration Time: 2026-10-11T12:35:45Z',
      ].join('\n'),
    );
  });
});

describe('Paradex REST calls', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('classifies the eip191 onboarding lookup', async () => {
    vi.stubGlobal('fetch', respond(200, { address: '0xabc', exists: true }));
    expect(await lookupParadexEvmAccount(PARADEX_PROD, ADDRESS)).toEqual({ kind: 'evm', address: '0xabc' });

    vi.stubGlobal('fetch', respond(200, { address: '0xabc', exists: false }));
    expect(await lookupParadexEvmAccount(PARADEX_PROD, ADDRESS)).toEqual({ kind: 'not_onboarded' });

    vi.stubGlobal(
      'fetch',
      respond(400, {
        error: 'INVALID_REQUEST_PARAMETER',
        message: 'wallet already linked to an existing starknet account',
      }),
    );
    expect(await lookupParadexEvmAccount(PARADEX_PROD, ADDRESS)).toEqual({ kind: 'starknet_linked' });
  });

  it('sends SIWE auth headers to the v2 endpoint', async () => {
    const fetchMock = respond(200, { jwt_token: 'session' });
    vi.stubGlobal('fetch', fetchMock);
    const jwt = await paradexEvmAuth({
      env: PARADEX_PROD,
      paradexAccount: '0xabc',
      siweMessage: 'héllo',
      signature: '0xsig',
    });
    expect(jwt).toBe('session');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.prod.paradex.trade/v2/auth');
    expect(init.headers).toEqual({
      'PARADEX-STARKNET-ACCOUNT': '0xabc',
      'PARADEX-EVM-SIGNATURE': '0xsig',
      'PARADEX-SIWE-MESSAGE': Buffer.from('héllo').toString('base64'),
    });
  });

  it('creates a read-only key with the server-chosen expiry and allowlist', async () => {
    const fetchMock = respond(200, { token: 'readonly', api_token: {} });
    vi.stubGlobal('fetch', fetchMock);
    const token = await createParadexReadonlyToken({
      env: PARADEX_PROD,
      sessionJwt: 'session',
      settings: { name: 'oggregator read-only', expiryDurationSec: 86_400, allowedCidrs: ['203.0.113.7/32'] },
    });
    expect(token).toBe('readonly');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.prod.paradex.trade/v1/account/tokens');
    expect(init.headers.Authorization).toBe('Bearer session');
    expect(JSON.parse(init.body)).toEqual({
      name: 'oggregator read-only',
      token_type: 'JWT',
      expiry_duration: 86_400,
      allowed_cidrs: ['203.0.113.7/32'],
    });
  });

  it('surfaces the Paradex error message', async () => {
    vi.stubGlobal('fetch', respond(403, { error: 'IP_NOT_ALLOWED', message: 'IP restrictions not enabled for this account' }));
    await expect(
      createParadexReadonlyToken({
        env: PARADEX_PROD,
        sessionJwt: 'session',
        settings: { name: 'x', expiryDurationSec: 60, allowedCidrs: ['203.0.113.7/32'] },
      }),
    ).rejects.toThrow('Paradex: IP restrictions not enabled for this account');
  });
});
