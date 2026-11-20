import type { PremiumSpikeQuery, PremiumSpikeResponse } from '@oggregator/protocol';
import type { VenueOptionChain } from '../../core/types.js';
import {
  emptyPremiumSpikeTenors,
  premiumSpikeSample,
  premiumSpikeSession,
  selectPremiumSpikeExpiries,
} from './model.js';

export interface PremiumSpikeSource {
  expiries(query: PremiumSpikeQuery): Promise<Array<{ expiry: string; expiryTs: number | null }>>;
  chains(query: PremiumSpikeQuery, expiries: string[]): Promise<VenueOptionChain[]>;
}
export interface PremiumSpikeHistory {
  load(): Promise<PremiumSpikeResponse[]>;
  save(states: PremiumSpikeResponse[]): Promise<void>;
}
interface Options {
  source: PremiumSpikeSource;
  history?: PremiumSpikeHistory;
  now?: () => number;
  log?: { warn(obj: object, message: string): void };
}

export class PremiumSpikeRuntime {
  private readonly states = new Map<string, PremiumSpikeResponse>();
  private readonly now: () => number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private pending: Promise<void> | null = null;
  private disposed = false;

  constructor(private readonly options: Options) {
    this.now = options.now ?? Date.now;
  }

  async start(): Promise<void> {
    try {
      for (const state of (await this.options.history?.load()) ?? []) {
        this.states.set(this.key(state), state);
        this.rollover(state);
      }
    } catch (err: unknown) {
      this.options.log?.warn({ err }, 'Premium spike history restore failed');
    }
    if (this.disposed || this.timer) return;
    this.timer = setInterval(() => {
      void this.scan();
    }, 10_000);
    this.timer.unref();
    void this.scan();
  }

  watch(query: PremiumSpikeQuery): PremiumSpikeResponse {
    const key = this.key(query);
    let state = this.states.get(key);
    if (!state) {
      if (this.states.size >= 8)
        throw new Error('Premium spike monitor limit reached (8 asset/venue pairs)');
      const now = this.now();
      const session = premiumSpikeSession(now);
      state = {
        ...query,
        delta: 0.25,
        timeZone: 'America/Los_Angeles',
        sessionStartMs: session.start,
        sessionEndMs: session.end,
        monitorStartedAt: now,
        lastScanAt: null,
        error: null,
        tenors: emptyPremiumSpikeTenors(),
        alerts: [],
        alertCount: 0,
      };
      this.states.set(key, state);
      void this.scan();
    }
    this.rollover(state);
    return state;
  }

  scan(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.pending) return this.pending;
    this.pending = this.runScan().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.pending;
  }

  private key(query: PremiumSpikeQuery): string {
    return `${query.underlying}:${query.venue}`;
  }

  private rollover(state: PremiumSpikeResponse): void {
    const session = premiumSpikeSession(this.now());
    if (state.sessionStartMs === session.start) return;
    state.sessionStartMs = session.start;
    state.sessionEndMs = session.end;
    state.tenors = emptyPremiumSpikeTenors();
    state.alerts = [];
    state.alertCount = 0;
    state.lastScanAt = null;
    state.error = null;
  }

  private async runScan(): Promise<void> {
    await Promise.all(
      [...this.states.values()].map(async (state) => {
        try {
          this.rollover(state);
          const sessionStart = state.sessionStartMs;
          let tenors = state.tenors;
          if (!tenors.some((row) => row.expiry != null)) {
            tenors = selectPremiumSpikeExpiries(
              await this.options.source.expiries(state),
              this.now(),
            );
          }
          const expiries = [...new Set(tenors.flatMap((row) => (row.expiry ? [row.expiry] : [])))];
          const chains = await this.options.source.chains(state, expiries);
          const now = this.now();
          // A source request that straddles midnight cannot seed the new session with the old selection.
          if (
            premiumSpikeSession(now).start !== sessionStart ||
            state.sessionStartMs !== sessionStart
          ) {
            this.rollover(state);
            return;
          }
          state.tenors = tenors;
          state.lastScanAt = now;
          state.error = null;
          for (const row of state.tenors) {
            const chain = chains.find(
              (c) =>
                c.expiry === row.expiry &&
                c.venue === state.venue &&
                c.underlying === state.underlying,
            );
            row.sample =
              chain && row.expiryTs != null ? premiumSpikeSample(chain, row.expiryTs, now) : null;
            const sample = row.sample;
            if (
              !sample ||
              sample.quoteAt < state.sessionStartMs ||
              row.expiry == null ||
              row.expiryTs == null
            ) {
              row.sample = null;
              continue;
            }
            row.trackingSince ??= now;
            for (const side of ['put', 'call'] as const) {
              const highKey = side === 'put' ? 'putHigh' : 'callHigh';
              const current = side === 'put' ? sample.putSkew : sample.callSkew;
              const high = row[highKey];
              if (high && current.bid > high.bid + 1e-10 && current.ask > high.ask + 1e-10) {
                state.alertCount += 1;
                state.alerts.unshift({
                  id: `${state.sessionStartMs}:${state.alertCount}`,
                  timestamp: now,
                  tenor: row.tenor,
                  expiry: row.expiry,
                  expiryTs: row.expiryTs,
                  side,
                  previousHigh: { ...high },
                  sample,
                });
              }
              row[highKey] = {
                bid: Math.max(high?.bid ?? -Infinity, current.bid),
                ask: Math.max(high?.ask ?? -Infinity, current.ask),
              };
            }
          }
          state.alerts = state.alerts.slice(0, 500);
        } catch (err: unknown) {
          state.error = err instanceof Error ? err.message : String(err);
          for (const row of state.tenors) row.sample = null;
          this.options.log?.warn(
            { err, underlying: state.underlying, venue: state.venue },
            'Premium spike scan failed',
          );
        }
      }),
    );
    try {
      await this.options.history?.save([...this.states.values()]);
    } catch (err: unknown) {
      this.options.log?.warn({ err }, 'Premium spike history save failed');
    }
  }
}
