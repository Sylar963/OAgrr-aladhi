import { randomUUID } from 'node:crypto';
import type { AlertSeverity, LiveAlert } from '@oggregator/protocol';
import type { AlertSink } from './sinks.js';

const COOLDOWN_MS = 60_000;
const RETRY_DELAYS_MS = [1_000, 4_000];

export interface AlertInput {
  event: string;
  severity: AlertSeverity;
  message: string;
  details?: Record<string, unknown>;
}

export interface DeliveryResult {
  alert: LiveAlert;
  delivered: Array<AlertSink['name']>;
  failed: Array<{ sink: AlertSink['name']; error: string }>;
  suppressed: boolean;
}

export interface AlerterOptions {
  telegram: AlertSink | null;
  email: AlertSink | null;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  onDeliveryFailure?: (result: DeliveryResult) => void;
}

/**
 * Severity routing from the program spec: critical → Telegram + email, never cooled down;
 * error → Telegram; info → Telegram now, email in the daily digest.
 */
export class Alerter {
  private readonly lastSentAt = new Map<string, number>();
  private readonly digest: LiveAlert[] = [];
  private testDelivered = false;
  private criticalLost = false;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: AlerterOptions) {
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  get configured(): { telegram: boolean; email: boolean } {
    return { telegram: this.options.telegram !== null, email: this.options.email !== null };
  }

  get testAlertDelivered(): boolean {
    return this.testDelivered;
  }

  /** A critical alert reached no sink. Arming stays blocked until a test alert gets through. */
  get criticalAlertLost(): boolean {
    return this.criticalLost;
  }

  /** Arming requires this to have reached both sinks since start-up. */
  async sendTest(): Promise<DeliveryResult> {
    const result = await this.deliver(
      this.build({ event: 'alert_test', severity: 'info', message: 'Live alert channel test.' }),
      ['telegram', 'email'],
    );
    this.testDelivered = result.failed.length === 0 && result.delivered.length === 2;
    if (this.testDelivered) this.criticalLost = false;
    return result;
  }

  async send(input: AlertInput): Promise<DeliveryResult> {
    const alert = this.build(input);
    if (input.severity !== 'critical') {
      const last = this.lastSentAt.get(input.event) ?? Number.NEGATIVE_INFINITY;
      if (this.now() - last < COOLDOWN_MS) {
        return { alert, delivered: [], failed: [], suppressed: true };
      }
    }
    this.lastSentAt.set(input.event, this.now());
    if (input.severity === 'info') this.digest.push(alert);
    const targets: Array<AlertSink['name']> =
      input.severity === 'critical' ? ['telegram', 'email'] : ['telegram'];
    return this.deliver(alert, targets);
  }

  /** Emails the info alerts gathered since the last digest. */
  async flushDigest(): Promise<DeliveryResult | null> {
    if (this.digest.length === 0) return null;
    const items = this.digest.splice(0);
    const message = items.map((a) => `${a.ts} ${a.event}: ${a.message}`).join('\n');
    return this.deliver(
      this.build({ event: 'daily_digest', severity: 'info', message: message.slice(0, 1000) }),
      ['email'],
    );
  }

  private build(input: AlertInput): LiveAlert {
    return {
      id: randomUUID(),
      source: 'oggregator-execution',
      event: input.event,
      severity: input.severity,
      message: input.message.slice(0, 1000),
      ts: new Date(this.now()).toISOString(),
      details: input.details ?? {},
    };
  }

  private async deliver(
    alert: LiveAlert,
    targets: Array<AlertSink['name']>,
  ): Promise<DeliveryResult> {
    const result: DeliveryResult = { alert, delivered: [], failed: [], suppressed: false };
    await Promise.all(
      targets.map(async (name) => {
        const sink = name === 'telegram' ? this.options.telegram : this.options.email;
        if (!sink) {
          result.failed.push({ sink: name, error: 'not configured' });
          return;
        }
        let lastError: unknown;
        for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
          try {
            await sink.send(alert);
            result.delivered.push(name);
            return;
          } catch (error) {
            lastError = error;
            const delay = RETRY_DELAYS_MS[attempt];
            if (delay !== undefined) await this.sleep(delay);
          }
        }
        result.failed.push({
          sink: name,
          error: lastError instanceof Error ? lastError.message : String(lastError),
        });
      }),
    );
    if (alert.severity === 'critical' && result.delivered.length === 0) this.criticalLost = true;
    if (result.failed.length > 0) this.options.onDeliveryFailure?.(result);
    return result;
  }
}
