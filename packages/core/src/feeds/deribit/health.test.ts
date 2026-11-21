import { describe, expect, it } from 'vitest';
import {
  applyDeribitPlatformState,
  applyDeribitPublicStatus,
  createDeribitHealthState,
  deriveDeribitPlatformHealth,
  deriveDeribitPublicStatusHealth,
} from './health.js';

describe('Deribit health', () => {
  it('marks maintenance as degraded', () => {
    const state = createDeribitHealthState();

    applyDeribitPlatformState(state, { maintenance: true });

    expect(deriveDeribitPlatformHealth(state)).toMatchObject({
      status: 'degraded',
      message: 'platform maintenance',
    });
  });

  it('tracks locked indices from platform_state', () => {
    const state = createDeribitHealthState();

    applyDeribitPlatformState(state, { price_index: 'btc_usd', locked: true });
    expect(deriveDeribitPlatformHealth(state)).toMatchObject({
      status: 'degraded',
      message: 'locked indices: btc_usd',
    });

    applyDeribitPlatformState(state, { price_index: 'btc_usd', locked: false });
    expect(deriveDeribitPlatformHealth(state)).toMatchObject({
      status: 'connected',
      message: 'platform healthy',
    });
  });

  it('prefers explicit public/status locks over healthy platform state', () => {
    const state = createDeribitHealthState();

    const health = deriveDeribitPublicStatusHealth(state, {
      locked: 'partial',
      locked_indices: ['eth_usd'],
    });

    expect(health).toMatchObject({
      status: 'degraded',
      message: 'public status locked: eth_usd',
    });
  });

  it('accepts the boolean locked form shown in the public/status example', () => {
    const state = createDeribitHealthState();

    const health = deriveDeribitPublicStatusHealth(state, {
      locked: true,
      locked_currencies: ['BTC', 'ETH'],
    });

    expect(health).toMatchObject({
      status: 'degraded',
      message: 'public status locked: BTC, ETH',
    });
  });

  it('surfaces probe failures as degraded', () => {
    const state = createDeribitHealthState();
    const health = deriveDeribitPublicStatusHealth(state, null, new Error('timeout'));

    expect(health).toMatchObject({
      status: 'degraded',
      message: 'public status probe failed: Error: timeout',
    });
  });
});

describe('Deribit warning scope and persistence', () => {
  it('preserves a partial public lock across healthy platform updates', () => {
    const state = createDeribitHealthState();
    applyDeribitPublicStatus(state, { locked: 'partial', locked_indices: ['sol_eth'] });
    applyDeribitPlatformState(state, { maintenance: false });
    expect(deriveDeribitPlatformHealth(state)).toMatchObject({
      status: 'degraded',
      health: { scope: 'indices', affectedIndices: ['sol_eth'], code: 'index-lock' },
    });
    applyDeribitPublicStatus(state, { locked: false });
    expect(deriveDeribitPlatformHealth(state).status).toBe('connected');
  });

  it('fails closed for unknown scope, full lock, maintenance and failed probes', () => {
    const state = createDeribitHealthState();
    expect(deriveDeribitPublicStatusHealth(state, { locked: 'partial' }).health.scope).toBe(
      'venue',
    );
    expect(
      deriveDeribitPublicStatusHealth(state, { locked: true, locked_indices: ['sol_eth'] }).health
        .scope,
    ).toBe('venue');
    applyDeribitPublicStatus(state, { locked: 'partial', locked_indices: ['sol_eth'] });
    applyDeribitPublicStatus(state, null, new Error('timeout'));
    applyDeribitPlatformState(state, { maintenance: false });
    expect(deriveDeribitPlatformHealth(state)).toMatchObject({
      status: 'degraded',
      health: { code: 'status-probe', scope: 'venue' },
    });
    applyDeribitPlatformState(state, { maintenance: true });
    expect(deriveDeribitPlatformHealth(state).health.code).toBe('maintenance');
  });
});
