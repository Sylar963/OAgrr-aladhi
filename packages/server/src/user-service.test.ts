import type { FastifyReply, FastifyRequest } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = {
  dbEnabled: false,
  identity: null as {
    clerkUserId: string;
    email: string | null;
    displayName: string | null;
  } | null,
  upsertResult: null as {
    id: string;
    defaultAccountId: string | null;
    displayName: string | null;
  } | null,
};

const { fundedStoreMock } = vi.hoisted(() => ({
  fundedStoreMock: { enabled: true as boolean, listRunsForUser: vi.fn() },
}));

vi.mock('./clerk-verifier.js', () => ({
  verifyClerkToken: vi.fn(async () => state.identity),
}));

vi.mock('./trading-services.js', () => ({
  paperTradingStore: {
    get enabled() {
      return state.dbEnabled;
    },
    ensureAccount: vi.fn(async () => {}),
  },
  usersStore: {
    get enabled() {
      return state.dbEnabled;
    },
    getByClerkId: vi.fn(async () => state.upsertResult),
    upsertByClerkId: vi.fn(async () => state.upsertResult),
  },
}));

vi.mock('./funded-services.js', () => ({ fundedStore: fundedStoreMock }));

function fakeReq(headers: Record<string, string>): FastifyRequest {
  return { headers, url: '/api/paper/positions' } as unknown as FastifyRequest;
}
function fakeReply(): FastifyReply & { _status: number; _body: unknown } {
  const r = {
    _status: 200,
    _body: undefined as unknown,
    status(code: number) {
      r._status = code;
      return r;
    },
    send(body: unknown) {
      r._body = body;
      return r;
    },
  };
  return r as unknown as FastifyReply & { _status: number; _body: unknown };
}

beforeEach(() => {
  vi.resetModules();
  state.dbEnabled = false;
  state.identity = null;
  state.upsertResult = null;
});

describe('requireUser (no-DB fallback)', () => {
  it('resolves without auth when DB is disabled', async () => {
    const { requireUser } = await import('./user-service.js');
    const reply = fakeReply();
    await requireUser()(fakeReq({}), reply);
    expect(reply._status).toBe(200);
  });
});

describe('requireUser (DB enabled)', () => {
  it('401s when no Bearer token', async () => {
    state.dbEnabled = true;
    const { requireUser } = await import('./user-service.js');
    const reply = fakeReply();
    await requireUser()(fakeReq({}), reply);
    expect(reply._status).toBe(401);
  });

  it('resolves and sets request.user for a valid token', async () => {
    state.dbEnabled = true;
    state.identity = { clerkUserId: 'user_1', email: 'a@b.co', displayName: 'A' };
    state.upsertResult = { id: 'usr_1', defaultAccountId: 'acct_1', displayName: 'A' };
    const { requireUser } = await import('./user-service.js');
    const req = fakeReq({ authorization: 'Bearer good' });
    const reply = fakeReply();
    await requireUser()(req, reply);
    expect(reply._status).toBe(200);
    expect(req.user).toEqual({ id: 'usr_1', accountId: 'acct_1', label: 'A' });
  });

  it('401s for an invalid token', async () => {
    state.dbEnabled = true;
    state.identity = null;
    const { requireUser } = await import('./user-service.js');
    const reply = fakeReply();
    await requireUser()(fakeReq({ authorization: 'Bearer bad' }), reply);
    expect(reply._status).toBe(401);
  });
});

describe('syncUser', () => {
  it('returns null for an invalid token', async () => {
    state.dbEnabled = true;
    state.identity = null;
    const { syncUser } = await import('./user-service.js');
    expect(await syncUser('bad')).toBeNull();
  });

  it('upserts and returns accountId for a valid token', async () => {
    state.dbEnabled = true;
    state.identity = { clerkUserId: 'user_1', email: 'a@b.co', displayName: 'A' };
    state.upsertResult = { id: 'usr_1', defaultAccountId: 'acct_1', displayName: 'A' };
    const { syncUser } = await import('./user-service.js');
    expect(await syncUser('good')).toEqual({ accountId: 'acct_1' });
  });
});

function scopeReq(
  user?: { id: string; accountId: string; label: string },
  accountId?: string,
): FastifyRequest {
  return {
    user,
    query: accountId ? { accountId } : {},
    headers: {},
  } as unknown as FastifyRequest;
}

describe('authorizeAccountScope', () => {
  beforeEach(() => {
    state.dbEnabled = false;
    fundedStoreMock.enabled = true;
    fundedStoreMock.listRunsForUser.mockReset();
  });

  it('falls back to DEFAULT_ACCOUNT_ID when persistence is disabled and no user', async () => {
    const { authorizeAccountScope } = await import('./user-service.js');
    const id = await authorizeAccountScope(scopeReq(), undefined);
    expect(id).toBe('paper-default');
  });

  it('returns the user default when no scope is requested', async () => {
    state.dbEnabled = true;
    const { authorizeAccountScope } = await import('./user-service.js');
    const id = await authorizeAccountScope(
      scopeReq({ id: 'u1', accountId: 'acct_default', label: 'a' }),
      undefined,
    );
    expect(id).toBe('acct_default');
  });

  it('allows a funded-run account owned by the user', async () => {
    state.dbEnabled = true;
    fundedStoreMock.listRunsForUser.mockResolvedValue([
      { paperAccountId: 'acct_run1', userId: 'u1' },
    ]);
    const { authorizeAccountScope } = await import('./user-service.js');
    const id = await authorizeAccountScope(
      scopeReq({ id: 'u1', accountId: 'acct_default', label: 'a' }, 'acct_run1'),
      'acct_run1',
    );
    expect(id).toBe('acct_run1');
  });

  it('throws 403 for a foreign account', async () => {
    state.dbEnabled = true;
    fundedStoreMock.listRunsForUser.mockResolvedValue([
      { paperAccountId: 'acct_run1', userId: 'u1' },
    ]);
    const { authorizeAccountScope } = await import('./user-service.js');
    await expect(
      authorizeAccountScope(
        scopeReq({ id: 'u1', accountId: 'acct_default', label: 'a' }, 'acct_foreign'),
        'acct_foreign',
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
