import { describe, expect, it } from 'vitest';
import { Alerter } from './alerts/alerter.js';
import type { AlertSink } from './alerts/sinks.js';
import { ControlError, LiveControl } from './control.js';
import { Journal } from './journal.js';
import type { TradingKeyMetadata } from './key-store.js';
import { StubVenueGateway, type VenueGateway } from './venue-gateway.js';

const owner = { clerkUserId: 'user_1', accountId: 'acct_1' };
const stranger = { clerkUserId: 'user_2', accountId: 'acct_2' };
const noSleep = async () => {};

function okSink(name: AlertSink['name']): AlertSink & { events: string[] } {
  const events: string[] = [];
  return { name, events, async send(alert) {
    events.push(alert.event);
  } };
}

const boundKey = { kid: 'kid-0042a1b2', env: 'test', venueAccount: 'A0001' } as TradingKeyMetadata;

async function setup(options: { alertsReady?: boolean; journal?: Journal; gateway?: VenueGateway } = {}) {
  const telegram = okSink('telegram');
  const email = okSink('email');
  const alerter = new Alerter({ telegram, email, sleep: noSleep });
  if (options.alertsReady !== false) await alerter.sendTest();
  const journal = options.journal ?? Journal.memory();
  const gateway = options.gateway ?? new StubVenueGateway();
  const control = new LiveControl({
    journal,
    alerter,
    gateway,
    keys: { findForActor: (actor) => (actor.clerkUserId === owner.clerkUserId ? [boundKey] : []) },
  });
  return { control, journal, gateway, telegram, email };
}

describe('LiveControl', () => {
  it('arms only for an actor with a bound key and working alerts', async () => {
    const { control } = await setup();
    await expect(control.arm(stranger)).rejects.toMatchObject({ code: 'not_bound' });

    const status = await control.arm(owner);
    expect(status.state).toBe('armed');
  });

  it('refuses to arm before the test alert has reached both sinks', async () => {
    const { control } = await setup({ alertsReady: false });
    await expect(control.arm(owner)).rejects.toBeInstanceOf(ControlError);
    await expect(control.arm(owner)).rejects.toMatchObject({ code: 'alerts_unavailable' });
  });

  it('kill latches, calls the gateway, journals and sends a critical alert', async () => {
    const { control, journal, gateway, telegram, email } = await setup();
    await control.arm(owner);

    const status = await control.kill(owner, { kind: 'global' }, 'manual');

    expect(status.state).toBe('killed');
    expect(status.killedReason).toBe('manual');
    expect((gateway as StubVenueGateway).kills).toEqual([{ kind: 'global' }]);
    expect(journal.lastOfType(['kill_report'])?.payload).toMatchObject({
      steps: expect.arrayContaining(['stub:cancel_all_conditional_orders']),
    });
    expect(telegram.events).toContain('kill_switch');
    expect(email.events).toContain('kill_switch');
    await expect(control.arm(owner)).rejects.toMatchObject({ code: 'killed' });
  });

  it('still latches and alerts when the venue cancel throws', async () => {
    const failing: VenueGateway = {
      name: 'failing',
      connected: () => true,
      killAll: async () => {
        throw new Error('socket closed');
      },
    };
    const { control, journal, email } = await setup({ gateway: failing });

    const status = await control.kill(owner, { kind: 'global' }, 'manual');

    expect(status.state).toBe('killed');
    expect(journal.lastOfType(['kill_failed'])?.payload).toMatchObject({ error: 'socket closed' });
    expect(email.events).toContain('kill_switch');
  });

  it('keeps the kill latched across a restart, but never stays armed', async () => {
    const journal = Journal.memory();
    const first = await setup({ journal });
    await first.control.arm(owner);
    expect((await setup({ journal })).control.current).toBe('disarmed');

    await first.control.kill(owner, { kind: 'global' }, 'manual');
    const restarted = await setup({ journal });
    expect(restarted.control.current).toBe('killed');

    await restarted.control.reset(owner, 'checked venue');
    expect((await setup({ journal })).control.current).toBe('disarmed');
  });

  it('reports status with key binding and journal health', async () => {
    const { control } = await setup();
    await control.kill(owner, { kind: 'global' }, 'manual');

    const status = control.status(owner);
    expect(status).toMatchObject({
      keyBound: true,
      tradingKeys: [{ environment: 'test', kidHint: 'a1b2', venueAccount: 'A0001' }],
      venue: { name: 'stub', connected: false },
      alerts: { telegramConfigured: true, emailConfigured: true, testDelivered: true },
      journal: { chainOk: true },
    });
    expect(control.status(stranger)).toMatchObject({ keyBound: false, tradingKeys: [] });
  });
});
