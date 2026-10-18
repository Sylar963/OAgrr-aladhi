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
import { actorLabel, type StepUpVerifier } from './step-up.js';
import type { KillReport, VenueGateway } from './venue-gateway.js';

const CONTROL_EVENTS = ['armed', 'disarmed', 'killed', 'reset'] as const;
/** Journal actor for daemon-raised events. A `killed` row from it latches every actor. */
export const SYSTEM_ACTOR = 'system';

const STEP_UP_MESSAGES = {
  step_up_failed: 'Authenticator code is wrong or was already used.',
  step_up_not_enrolled: 'No authenticator is enrolled for this user; run totp:enroll on the host.',
  step_up_locked: 'Too many wrong authenticator codes; try again in 15 minutes.',
} as const;

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
  stepUp: Pick<StepUpVerifier, 'verify' | 'isEnrolled'>;
}

interface ActorControl {
  state: LiveControlState;
  killedReason: string | null;
}

/**
 * Armed / disarmed / killed, per actor (charter D9). A kill latches across restarts because each
 * actor's state is rebuilt from the journal; armed never does, so a restarted daemon comes up
 * disarmed for everyone.
 */
export class LiveControl {
  private readonly actors = new Map<string, ActorControl>();
  // Verified once at start-up; re-hashing the whole journal on every status poll doesn't scale.
  private readonly chainOk: boolean;

  constructor(private readonly deps: LiveControlDependencies) {
    this.chainOk = deps.journal.verifyChain() === null;
  }

  stateOf(actor: LiveActor): LiveControlState {
    return this.control(actor).state;
  }

  async execute(actor: LiveActor, command: ExecutionCommand): Promise<LiveStatus> {
    switch (command.type) {
      case 'status':
        return this.status(actor);
      case 'arm':
        return this.arm(actor, command.otp);
      case 'disarm':
        return this.disarm(actor, command.reason);
      case 'kill':
        return this.kill(actor, command.scope, command.reason);
      case 'reset':
        return this.reset(actor, command.reason, command.otp);
    }
  }

  status(actor: LiveActor): LiveStatus {
    const control = this.control(actor);
    const configured = this.deps.alerter.configured;
    const keys = this.deps.keys.findForActor(actor);
    return {
      state: control.state,
      killedReason: control.killedReason,
      keyBound: keys.length > 0,
      tradingKeys: keys.map((key) => ({
        environment: key.env,
        kidHint: key.kid.slice(-4),
        venueAccount: key.venueAccount,
      })),
      stepUpEnrolled: this.deps.stepUp.isEnrolled(actor),
      venue: { name: this.deps.gateway.name, connected: this.deps.gateway.connected(actor) },
      alerts: {
        telegramConfigured: configured.telegram,
        emailConfigured: configured.email,
        testDelivered:
          this.deps.alerter.testAlertDelivered && !this.deps.alerter.criticalAlertLost,
      },
      journal: { lastSeq: this.deps.journal.lastSeq(), chainOk: this.chainOk },
    };
  }

  async arm(actor: LiveActor, otp: string): Promise<LiveStatus> {
    const control = this.control(actor);
    if (control.state === 'killed') {
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
    // Last, so a code is only spent on a request that would otherwise succeed.
    this.requireStepUp(actor, otp, 'arm');
    control.state = 'armed';
    this.deps.journal.append(actorLabel(actor), 'armed', {});
    await this.deps.alerter.send({ event: 'armed', severity: 'info', message: 'Live trading armed.' });
    return this.status(actor);
  }

  async disarm(actor: LiveActor, reason: string): Promise<LiveStatus> {
    const control = this.control(actor);
    if (control.state === 'armed') {
      control.state = 'disarmed';
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
    const control = this.control(actor);
    control.state = 'killed';
    control.killedReason = reason;
    this.deps.journal.append(actorLabel(actor), 'killed', { scope, reason });
    await this.runKill(() => this.deps.gateway.killAll(actor, scope), scope, reason);
    return this.status(actor);
  }

  /** Daemon-raised stop for every actor (journal failure, host CLI). Each actor resets on their own. */
  async killEveryone(reason: string): Promise<void> {
    for (const control of this.actors.values()) {
      control.state = 'killed';
      control.killedReason = reason;
    }
    const scope: KillScope = { kind: 'global' };
    this.deps.journal.append(SYSTEM_ACTOR, 'killed', { scope, reason, allActors: true });
    await this.runKill(() => this.deps.gateway.killEverything(), scope, reason);
  }

  async reset(actor: LiveActor, reason: string, otp: string): Promise<LiveStatus> {
    const control = this.control(actor);
    if (control.state === 'killed') {
      this.requireStepUp(actor, otp, 'reset');
      control.state = 'disarmed';
      control.killedReason = null;
      this.deps.journal.append(actorLabel(actor), 'reset', { reason });
      await this.deps.alerter.send({
        event: 'kill_reset',
        severity: 'error',
        message: `Kill switch reset: ${reason}`,
      });
    }
    return this.status(actor);
  }

  private control(actor: LiveActor): ActorControl {
    const label = actorLabel(actor);
    const cached = this.actors.get(label);
    if (cached) return cached;
    const last = this.deps.journal.lastOfTypeFor(CONTROL_EVENTS, [label, SYSTEM_ACTOR]);
    const control: ActorControl =
      last?.type === 'killed'
        ? { state: 'killed', killedReason: killedReasonOf(last.payload) }
        : { state: 'disarmed', killedReason: null };
    this.actors.set(label, control);
    return control;
  }

  private requireStepUp(actor: LiveActor, otp: string, action: string): void {
    const result = this.deps.stepUp.verify(actor, otp, action);
    if (!result.ok) throw new ControlError(result.code, STEP_UP_MESSAGES[result.code]);
  }

  private async runKill(
    cancel: () => Promise<KillReport>,
    scope: KillScope,
    reason: string,
  ): Promise<void> {
    let message = `Kill switch triggered: ${reason}`;
    try {
      const report = await cancel();
      this.deps.journal.append(SYSTEM_ACTOR, 'kill_report', { scope, ...report });
      if (report.remaining.length > 0) {
        message += ` - ${report.remaining.length} item(s) still working, check the venue now`;
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.deps.journal.append(SYSTEM_ACTOR, 'kill_failed', { scope, error: detail });
      message += ` - venue cancel failed: ${detail}`;
    }
    await this.deps.alerter.send({ event: 'kill_switch', severity: 'critical', message });
  }
}

function killedReasonOf(payload: unknown): string {
  const reason = (payload as { reason?: unknown } | null)?.reason;
  return typeof reason === 'string' ? reason : 'unknown';
}
