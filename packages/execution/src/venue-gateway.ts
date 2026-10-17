import type { KillScope } from '@oggregator/protocol';

export interface KillReport {
  /** Calls made, in order, so the journal shows exactly what the kill did. */
  steps: string[];
  /** Orders, conditional orders or bots still working after the sequence. Non-empty = alert. */
  remaining: string[];
}

/**
 * Venue side of the daemon. L2 implements it for Thalex: cancel conditional orders, then bots,
 * then the session, then everything else, then verify.
 */
export interface VenueGateway {
  readonly name: string;
  connected(): boolean;
  killAll(scope: KillScope): Promise<KillReport>;
}

/** L0 stand-in: records kills, talks to nothing. */
export class StubVenueGateway implements VenueGateway {
  readonly name = 'stub';
  readonly kills: KillScope[] = [];

  connected(): boolean {
    return false;
  }

  async killAll(scope: KillScope): Promise<KillReport> {
    this.kills.push(scope);
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
}
