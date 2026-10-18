import { describe, expect, it, vi } from 'vitest';
import { Alerter } from './alerts/alerter.js';
import type { AlertSink } from './alerts/sinks.js';
import { ControlError, LiveControl } from './control.js';
import { Journal } from './journal.js';
import type { TradingKeyMetadata } from './key-store.js';
import type { StepUpResult } from './step-up.js';
import { StubVenueGateway, type VenueGateway } from './venue-gateway.js';

const owner = { clerkUserId: 'user_1', accountId: 'acct_1' };
const second = { clerkUserId: 'user_3', accountId: 'acct_3' };
const stranger = { clerkUserId: 'user_2', accountId: 'acct_2' };
const GOOD = '111111';
const noSleep = async () => {};

function okSink(name: AlertSink['name']): AlertSink & { events: string[] } {
  const events: string[] = [];
  return { name, events, async send(alert) {
    events.push(alert.event);
  } };
}

const boundKey = { kid: 'kid-0042a1b2', env: 'test', venueAccount: 'A0001' } as TradingKeyMetadata;
const bound = new Set([owner.clerkUserId, second.clerkUserId]);

async function setup(options: { alertsReady?: boolean; journal?: Journal; gateway?: VenueGateway } = {}) {
  const telegram = okSink('telegram');
  const email = okSink('email');
  const alerter = new Alerter({ telegram, email, sleep: noSleep });
  if (options.alertsReady !== false) await alerter.sendTest();
  const journal = options.journal ?? Journal.memory();
  const gateway = options.gateway ?? new StubVenueGateway();
  const stepUp = {
    verify: vi.fn(
      (_actor: unknown, code: string): StepUpResult =>
        code === GOOD ? { ok: true } : { ok: false, code: 'step_up_failed' },
    ),
    isEnrolled: () => true,
  };
  const control = new LiveControl({
    journal,
    alerter,
    gateway,
    stepUp,
    keys: { findForActor: (actor) => (bound.has(actor.clerkUserId) ? [boundKey] : []) },
  });
  return { control, journal, gateway, telegram, email, stepUp };
}

describe('LiveControl', () => {
  it('arms only for an actor with a bound key, working alerts and a valid code', async () => {
    const { control } = await setup();
    await expect(control.arm(stranger, GOOD)).rejects.toMatchObject({ code: 'not_bound' });
    await expect(control.arm(owner, '222222')).rejects.toMatchObject({ code: 'step_up_failed' });

    const status = await control.arm(owner, GOOD);
    expect(status.state).toBe('armed');
  });

  it('does not spend the code on an arm that would fail anyway', async () => {
    const { control, stepUp } = await setup({ alertsReady: false });
    await expect(control.arm(owner, GOOD)).rejects.toBeInstanceOf(ControlError);
    await expect(control.arm(owner, GOOD)).rejects.toMatchObject({ code: 'alerts_unavailable' });
    expect(stepUp.verify).not.toHaveBeenCalled();
  });

  it('keeps every actor independent', async () => {
    const { control, gateway } = await setup();
    await control.arm(owner, GOOD);
    await control.arm(second, GOOD);

    await control.kill(second, { kind: 'global' }, 'their own stop');

    expect(control.stateOf(owner)).toBe('armed');
    expect(control.stateOf(second)).toBe('killed');
    expect((gateway as StubVenueGateway).kills).toEqual([
      { actor: second, scope: { kind: 'global' } },
    ]);
  });

  it('kill latches, calls the gateway, journals and sends a critical alert', async () => {
    const { control, journal, gateway, telegram, email } = await setup();
    await control.arm(owner, GOOD);

    const status = await control.kill(owner, { kind: 'global' }, 'manual');

    expect(status.state).toBe('killed');
    expect(status.killedReason).toBe('manual');
    expect((gateway as StubVenueGateway).kills).toEqual([{ actor: owner, scope: { kind: 'global' } }]);
    expect(journal.lastOfType(['kill_report'])?.payload).toMatchObject({
      steps: expect.arrayContaining(['stub:cancel_all_conditional_orders']),
    });
    expect(telegram.events).toContain('kill_switch');
    expect(email.events).toContain('kill_switch');
    await expect(control.arm(owner, GOOD)).rejects.toMatchObject({ code: 'killed' });
  });

  it('still latches and alerts when the venue cancel throws', async () => {
    const failing: VenueGateway = {
      name: 'failing',
      connected: () => true,
      killAll: async () => {
        throw new Error('socket closed');
      },
      killEverything: async () => {
        throw new Error('socket closed');
      },
    };
    const { control, journal, email } = await setup({ gateway: failing });

    const status = await control.kill(owner, { kind: 'global' }, 'manual');

    expect(status.state).toBe('killed');
    expect(journal.lastOfType(['kill_failed'])?.payload).toMatchObject({ error: 'socket closed' });
    expect(email.events).toContain('kill_switch');
  });

  it('needs a valid code to reset, and does not ask for one when nothing is killed', async () => {
    const { control, stepUp } = await setup();
    await control.reset(owner, 'nothing to reset', '000000');
    expect(stepUp.verify).not.toHaveBeenCalled();

    await control.kill(owner, { kind: 'global' }, 'manual');
    await expect(control.reset(owner, 'checked', '000000')).rejects.toMatchObject({
      code: 'step_up_failed',
    });
    expect(control.stateOf(owner)).toBe('killed');
    expect((await control.reset(owner, 'checked', GOOD)).state).toBe('disarmed');
  });

  it('keeps each kill latched across a restart, but never stays armed', async () => {
    const journal = Journal.memory();
    const first = await setup({ journal });
    await first.control.arm(owner, GOOD);
    await first.control.arm(second, GOOD);
    expect((await setup({ journal })).control.stateOf(owner)).toBe('disarmed');

    await first.control.kill(owner, { kind: 'global' }, 'manual');
    const restarted = await setup({ journal });
    expect(restarted.control.stateOf(owner)).toBe('killed');
    expect(restarted.control.stateOf(second)).toBe('disarmed');

    await restarted.control.reset(owner, 'checked venue', GOOD);
    expect((await setup({ journal })).control.stateOf(owner)).toBe('disarmed');
  });

  it('a daemon-wide kill latches every actor, and each resets on their own', async () => {
    const journal = Journal.memory();
    const { control, gateway } = await setup({ journal });
    await control.arm(owner, GOOD);

    await control.killEveryone('journal write failed');

    expect(control.stateOf(owner)).toBe('killed');
    expect(control.stateOf(second)).toBe('killed');
    expect((gateway as StubVenueGateway).kills).toEqual([
      { actor: 'all', scope: { kind: 'global' } },
    ]);

    const restarted = await setup({ journal });
    expect(restarted.control.stateOf(stranger)).toBe('killed');
    await restarted.control.reset(owner, 'checked', GOOD);
    expect(restarted.control.stateOf(owner)).toBe('disarmed');
    expect(restarted.control.stateOf(second)).toBe('killed');
  });

  it('reports status with key binding, step-up enrollment and journal health', async () => {
    const { control } = await setup();
    await control.kill(owner, { kind: 'global' }, 'manual');

    const status = control.status(owner);
    expect(status).toMatchObject({
      keyBound: true,
      tradingKeys: [{ environment: 'test', kidHint: 'a1b2', venueAccount: 'A0001' }],
      stepUpEnrolled: true,
      venue: { name: 'stub', connected: false },
      alerts: { telegramConfigured: true, emailConfigured: true, testDelivered: true },
      journal: { chainOk: true },
    });
    expect(control.status(stranger)).toMatchObject({ keyBound: false, tradingKeys: [] });
  });
});
