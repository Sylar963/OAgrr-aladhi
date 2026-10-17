import type {
  ExecutionCommand,
  ExecutionErrorCode,
  KillScope,
  LiveActor,
  LiveControlState,
  LiveStatus,
} from '@oggregator/protocol';
import type { Alerter } from './alerts/alerter.js';
import type { Journal } from './journal.js';
import type { KeyStore } from './key-store.js';
import type { VenueGateway } from './venue-gateway.js';

const CONTROL_EVENTS = ['armed', 'disarmed', 'killed', 'reset'] as const;

export class ControlError extends Error {
  constructor(
    readonly code: ExecutionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ControlError';
  }
}

export interface LiveControlDependencies {
  journal: Journal;
  alerter: Alerter;
  keys: Pick<KeyStore, 'findForActor'>;
  gateway: VenueGateway;
}

function actorLabel(actor: LiveActor): string {
  return `${actor.clerkUserId}/${actor.accountId}`;
}

/**
 * Armed / disarmed / killed. A kill latches across restarts (state is rebuilt from the journal);
 * armed never does - a restarted daemon comes up disarmed and must be armed again.
 */
export class LiveControl {
  private state: LiveControlState;
  private killedReason: string | null;
  // Verified once at start-up; re-hashing the whole journal on every status poll doesn't scale.
  private readonly chainOk: boolean;

  constructor(private readonly deps: LiveControlDependencies) {
    this.chainOk = deps.journal.verifyChain() === null;
    const last = deps.journal.lastOfType(CONTROL_EVENTS);
    if (last?.type === 'killed') {
      this.state = 'killed';
      const payload = last.payload as { reason?: unknown };
      this.killedReason = typeof payload.reason === 'string' ? payload.reason : 'unknown';
    } else {
      this.state = 'disarmed';
      this.killedReason = null;
    }
  }

  get current(): LiveControlState {
    return this.state;
  }

  async execute(actor: LiveActor, command: ExecutionCommand): Promise<LiveStatus> {
    switch (command.type) {
      case 'status':
        return this.status(actor);
      case 'arm':
        return this.arm(actor);
      case 'disarm':
        return this.disarm(actor, command.reason);
      case 'kill':
        return this.kill(actor, command.scope, command.reason);
      case 'reset':
        return this.reset(actor, command.reason);
    }
  }

  status(actor: LiveActor): LiveStatus {
    const configured = this.deps.alerter.configured;
    return {
      state: this.state,
      killedReason: this.killedReason,
      keyBound: this.deps.keys.findForActor(actor).length > 0,
      venue: { name: this.deps.gateway.name, connected: this.deps.gateway.connected() },
      alerts: {
        telegramConfigured: configured.telegram,
        emailConfigured: configured.email,
        testDelivered:
          this.deps.alerter.testAlertDelivered && !this.deps.alerter.criticalAlertLost,
      },
      journal: { lastSeq: this.deps.journal.lastSeq(), chainOk: this.chainOk },
    };
  }

  async arm(actor: LiveActor): Promise<LiveStatus> {
    if (this.state === 'killed') {
      throw new ControlError('killed', 'Kill switch is latched; reset it before arming.');
    }
    if (this.deps.keys.findForActor(actor).length === 0) {
      throw new ControlError('not_bound', 'No trading key is bound to this user and account.');
    }
    const { telegram, email } = this.deps.alerter.configured;
    if (
      !telegram ||
      !email ||
      !this.deps.alerter.testAlertDelivered ||
      this.deps.alerter.criticalAlertLost
    ) {
      throw new ControlError(
        'alerts_unavailable',
        'Telegram and email alerts must both be configured and delivering before arming.',
      );
    }
    this.state = 'armed';
    this.deps.journal.append(actorLabel(actor), 'armed', {});
    await this.deps.alerter.send({ event: 'armed', severity: 'info', message: 'Live trading armed.' });
    return this.status(actor);
  }

  async disarm(actor: LiveActor, reason: string): Promise<LiveStatus> {
    if (this.state === 'armed') {
      this.state = 'disarmed';
      this.deps.journal.append(actorLabel(actor), 'disarmed', { reason });
      await this.deps.alerter.send({
        event: 'disarmed',
        severity: 'info',
        message: `Live trading disarmed: ${reason}`,
      });
    }
    return this.status(actor);
  }

  /** Always accepted. Latches before touching the venue so nothing new starts mid-kill. */
  async kill(actor: LiveActor, scope: KillScope, reason: string): Promise<LiveStatus> {
    this.state = 'killed';
    this.killedReason = reason;
    this.deps.journal.append(actorLabel(actor), 'killed', { scope, reason });
    let message = `Kill switch triggered: ${reason}`;
    try {
      const report = await this.deps.gateway.killAll(scope);
      this.deps.journal.append('system', 'kill_report', { scope, ...report });
      if (report.remaining.length > 0) {
        message += ` - ${report.remaining.length} item(s) still working, check the venue now`;
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.deps.journal.append('system', 'kill_failed', { scope, error: detail });
      message += ` - venue cancel failed: ${detail}`;
    }
    await this.deps.alerter.send({ event: 'kill_switch', severity: 'critical', message });
    return this.status(actor);
  }

  async reset(actor: LiveActor, reason: string): Promise<LiveStatus> {
    if (this.state === 'killed') {
      this.state = 'disarmed';
      this.killedReason = null;
      this.deps.journal.append(actorLabel(actor), 'reset', { reason });
      await this.deps.alerter.send({
        event: 'kill_reset',
        severity: 'error',
        message: `Kill switch reset: ${reason}`,
      });
    }
    return this.status(actor);
  }
}
