import type { KillScope, LiveActor } from '@oggregator/protocol';

export interface KillReport {
  /** Calls made, in order, so the journal shows exactly what the kill did. */
  steps: string[];
  /** Orders, conditional orders or bots still working after the sequence. Non-empty = alert. */
  remaining: string[];
}

/**
 * Venue side of the daemon. One Thalex session per trading key (charter §10), so every call is
 * per actor. L2 implements it for Thalex: cancel conditional orders, then bots, then the session,
 * then everything else, then verify.
 */
export interface VenueGateway {
  readonly name: string;
  connected(actor: LiveActor): boolean;
  /** `global` scope = every subaccount of this actor, never another actor's. */
  killAll(actor: LiveActor, scope: KillScope): Promise<KillReport>;
  /** Daemon-wide stop, raised only by the daemon itself: every session of every actor. */
  killEverything(): Promise<KillReport>;
}

/** L0 stand-in: records kills, talks to nothing. */
export class StubVenueGateway implements VenueGateway {
  readonly name = 'stub';
  readonly kills: Array<{ actor: LiveActor | 'all'; scope: KillScope }> = [];

  connected(_actor: LiveActor): boolean {
    return false;
  }

  async killAll(actor: LiveActor, scope: KillScope): Promise<KillReport> {
    this.kills.push({ actor, scope });
    return stubReport();
  }

  async killEverything(): Promise<KillReport> {
    this.kills.push({ actor: 'all', scope: { kind: 'global' } });
    return stubReport();
  }
}

function stubReport(): KillReport {
  return {
    steps: [
      'cancel_all_conditional_orders',
      'cancel_all_bots',
      'cancel_session',
      'cancel_all',
      'verify',
    ].map((step) => `stub:${step}`),
    remaining: [],
  };
}
