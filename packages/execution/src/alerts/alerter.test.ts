import type { LiveAlert } from '@oggregator/protocol';
import { describe, expect, it, vi } from 'vitest';
import { Alerter } from './alerter.js';
import { type AlertSink, ResendSink, TelegramSink } from './sinks.js';

function sink(name: AlertSink['name'], fail = 0): AlertSink & { sent: LiveAlert[] } {
  let failures = fail;
  const sent: LiveAlert[] = [];
  return {
    name,
    sent,
    async send(alert) {
      if (failures > 0) {
        failures -= 1;
        throw new Error('down');
      }
      sent.push(alert);
    },
  };
}

const noSleep = async () => {};

describe('Alerter routing', () => {
  it('sends critical alerts to both sinks and never cools them down', async () => {
    const telegram = sink('telegram');
    const email = sink('email');
    const alerter = new Alerter({ telegram, email, now: () => 1_000, sleep: noSleep });

    await alerter.send({ event: 'kill_switch', severity: 'critical', message: 'killed' });
    await alerter.send({ event: 'kill_switch', severity: 'critical', message: 'killed again' });

    expect(telegram.sent).toHaveLength(2);
    expect(email.sent).toHaveLength(2);
  });

  it('sends errors to Telegram only, with a per-event cooldown', async () => {
    const telegram = sink('telegram');
    const email = sink('email');
    let now = 0;
    const alerter = new Alerter({ telegram, email, now: () => now, sleep: noSleep });

    await alerter.send({ event: 'disconnect', severity: 'error', message: 'a' });
    now = 30_000;
    const suppressed = await alerter.send({ event: 'disconnect', severity: 'error', message: 'b' });
    now = 61_000;
    await alerter.send({ event: 'disconnect', severity: 'error', message: 'c' });

    expect(suppressed.suppressed).toBe(true);
    expect(telegram.sent.map((a) => a.message)).toEqual(['a', 'c']);
    expect(email.sent).toHaveLength(0);
  });

  it('collects info alerts into an email digest', async () => {
    const telegram = sink('telegram');
    const email = sink('email');
    const alerter = new Alerter({ telegram, email, sleep: noSleep });

    await alerter.send({ event: 'bot_started', severity: 'info', message: 'dhedge on' });
    await alerter.send({ event: 'daemon_restart', severity: 'info', message: 'restarted' });
    expect(email.sent).toHaveLength(0);

    await alerter.flushDigest();
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]!.message).toContain('dhedge on');
    expect(email.sent[0]!.message).toContain('restarted');
    expect(await alerter.flushDigest()).toBeNull();
  });

  it('retries a failing sink and reports what could not be delivered', async () => {
    const telegram = sink('telegram', 1);
    const email = sink('email', 5);
    const onDeliveryFailure = vi.fn();
    const sleep = vi.fn(noSleep);
    const alerter = new Alerter({ telegram, email, sleep, onDeliveryFailure });

    const result = await alerter.send({ event: 'margin_call', severity: 'critical', message: 'x' });

    expect(result.delivered).toEqual(['telegram']);
    expect(result.failed).toEqual([{ sink: 'email', error: 'down' }]);
    expect(onDeliveryFailure).toHaveBeenCalledOnce();
  });

  it('flags a critical alert that reached no sink until a test alert succeeds', async () => {
    const telegram = sink('telegram', 3);
    const email = sink('email', 3);
    const alerter = new Alerter({ telegram, email, sleep: noSleep });

    await alerter.send({ event: 'kill_switch', severity: 'critical', message: 'x' });
    expect(alerter.criticalAlertLost).toBe(true);

    await alerter.sendTest();
    expect(alerter.criticalAlertLost).toBe(false);
  });

  it('marks the test alert delivered only when both sinks succeed', async () => {
    const onlyTelegram = new Alerter({ telegram: sink('telegram'), email: null, sleep: noSleep });
    await onlyTelegram.sendTest();
    expect(onlyTelegram.testAlertDelivered).toBe(false);

    const both = new Alerter({ telegram: sink('telegram'), email: sink('email'), sleep: noSleep });
    await both.sendTest();
    expect(both.testAlertDelivered).toBe(true);
  });
});

describe('sinks', () => {
  const alert: LiveAlert = {
    id: 'alert-1',
    source: 'oggregator-execution',
    event: 'kill_switch',
    severity: 'critical',
    message: 'Kill switch triggered',
    ts: '2026-10-17T00:00:00.000Z',
    details: { venueAccount: 'A123', positions: ['secret'] },
  };

  it('posts a send-only Telegram message without details', async () => {
    const fetchFn = vi.fn(async () => new Response('{}', { status: 200 }));
    await new TelegramSink('bot-token', '42', fetchFn).send(alert);

    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.telegram.org/botbot-token/sendMessage');
    const body = JSON.parse(String(init.body));
    expect(body.chat_id).toBe('42');
    expect(body.text).toContain('kill_switch');
    expect(body.text).not.toContain('A123');
    expect(body.text).not.toContain('secret');
  });

  it('posts to Resend with the alert id as idempotency key', async () => {
    const fetchFn = vi.fn(async () => new Response('{}', { status: 200 }));
    await new ResendSink('re_key', 'alerts@example.com', 'ops@example.com', fetchFn).send(alert);

    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(url).toBe('https://api.resend.com/emails');
    expect(headers['authorization']).toBe('Bearer re_key');
    expect(headers['idempotency-key']).toBe('alert-1');
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ from: 'alerts@example.com', to: ['ops@example.com'] });
    expect(body.text).not.toContain('A123');
  });

  it('throws on a non-2xx response', async () => {
    const fetchFn = vi.fn(async () => new Response('nope', { status: 401 }));
    await expect(new TelegramSink('t', '1', fetchFn).send(alert)).rejects.toThrow(/401/);
  });
});
