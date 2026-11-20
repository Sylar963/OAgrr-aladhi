import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PremiumSpikeResponseSchema } from '@oggregator/protocol';
const source = vi.hoisted(() => ({
  list: vi.fn(async () => []),
  sync: vi.fn(),
  fetch: vi.fn(async () => []),
}));
vi.mock('@oggregator/core', async (original) => ({
  ...(await original<typeof import('@oggregator/core')>()),
  getAdapter: () => ({ listExpiries: source.list }),
}));
vi.mock('../alpha-expiry-chains.js', () => ({
  createExpiryChainSource: () => ({ syncSubscriptions: source.sync, fetchChains: source.fetch }),
}));
const { premiumSpikeHistory, premiumSpikesRoute } = await import('./premium-spikes.js');
let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'premium-spikes-test-'));
  vi.stubEnv('PREMIUM_SPIKE_CACHE_PATH', join(directory, 'state.json'));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

describe('premium spike route and local history', () => {
  it('validates inputs before starting monitors and returns a typed warming report', async () => {
    const app = Fastify();
    await app.register(premiumSpikesRoute);
    for (const query of ['underlying=SOL', 'venue=unknown', 'underlying=BTC&venue=tastytrade']) {
      expect((await app.inject(`/premium-spikes?${query}`)).statusCode).toBe(400);
    }
    expect(source.list).not.toHaveBeenCalled();
    const response = await app.inject('/premium-spikes?underlying=BTC&venue=deribit');
    expect(response.statusCode).toBe(200);
    const data = PremiumSpikeResponseSchema.parse(response.json());
    expect(data.tenors).toHaveLength(4);
    expect(data.alerts).toEqual([]);
    expect(data.timeZone).toBe('America/Los_Angeles');
    await app.close();
  });
  it('roundtrips typed state atomically and rejects corrupt local history', async () => {
    const path = join(directory, 'nested', 'state.json');
    const history = premiumSpikeHistory(path);
    expect(await history.load()).toEqual([]);
    await history.save([]);
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual([]);
    expect(await history.load()).toEqual([]);
    await writeFile(path, '[{"underlying":"BTC"}]');
    await expect(history.load()).rejects.toThrow();
  });
});
