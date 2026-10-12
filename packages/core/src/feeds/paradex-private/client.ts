import type { EquityHistoryPoint, PositionLeg } from '@oggregator/protocol';

import { feedLogger } from '../../utils/logger.js';
import { PARADEX_REST_BASE_URL } from '../shared/endpoints.js';
import { paradexAccountHistoryToPoints, paradexPositionsToLegs } from './codec.js';
import { ParadexAccountHistorySchema, ParadexPositionsResponseSchema } from './types.js';

export interface ParadexPrivateCreds {
  readonlyToken: string;
}

export type ParadexPositionsListener = (legs: PositionLeg[]) => void;

export class ParadexAuthError extends Error {
  constructor(status: number) {
    super(`Paradex rejected the read-only token (HTTP ${status})`);
    this.name = 'ParadexAuthError';
  }
}

// Readonly tokens are documented for GET requests only, so positions are polled over
// REST rather than streamed from the private WebSocket.
const POSITIONS_REFRESH_MS = 15_000;

export class ParadexPrivateClient {
  private readonly listeners = new Set<ParadexPositionsListener>();
  private latestLegs: PositionLeg[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private refreshInFlight: Promise<void> | null = null;
  private readonly log = feedLogger('paradex-private');

  constructor(
    private readonly creds: ParadexPrivateCreds,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async start(): Promise<void> {
    await this.fetchPositions();
    this.timer = setInterval(() => void this.refresh(), POSITIONS_REFRESH_MS);
    this.timer.unref?.();
  }

  subscribe(listener: ParadexPositionsListener): () => void {
    this.listeners.add(listener);
    if (this.latestLegs.length > 0) {
      try {
        listener(this.latestLegs);
      } catch {}
    }
    return () => {
      this.listeners.delete(listener);
    };
  }

  getLatestLegs(): PositionLeg[] {
    return [...this.latestLegs];
  }

  async fetchEquityHistory(fromMs: number): Promise<EquityHistoryPoint[]> {
    const res = await this.fetchImpl(`${PARADEX_REST_BASE_URL}/account/history?type=value`, {
      headers: { Authorization: `Bearer ${this.creds.readonlyToken}` },
    });
    if (res.status === 401 || res.status === 403) throw new ParadexAuthError(res.status);
    if (!res.ok) throw new Error(`Paradex account history HTTP ${res.status}`);
    const parsed = ParadexAccountHistorySchema.safeParse(await res.json());
    if (!parsed.success) throw new Error(`Paradex account history parse failed: ${parsed.error.message}`);
    return paradexAccountHistoryToPoints(parsed.data).filter((point) => point.ts >= fromMs);
  }

  async dispose(): Promise<void> {
    this.stopPolling();
    this.listeners.clear();
  }

  private stopPolling(): void {
    if (this.timer != null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private refresh(): Promise<void> {
    if (this.refreshInFlight != null) return this.refreshInFlight;
    this.refreshInFlight = this.fetchPositions()
      .catch((err: unknown) => {
        if (err instanceof ParadexAuthError) {
          this.log.warn({ err: err.message }, 'paradex read-only token rejected; polling stopped');
          this.stopPolling();
          return;
        }
        this.log.warn({ err: String(err) }, 'paradex positions refresh failed');
      })
      .finally(() => {
        this.refreshInFlight = null;
      });
    return this.refreshInFlight;
  }

  private async fetchPositions(): Promise<void> {
    const res = await this.fetchImpl(`${PARADEX_REST_BASE_URL}/positions`, {
      headers: { Authorization: `Bearer ${this.creds.readonlyToken}` },
    });
    if (res.status === 401 || res.status === 403) throw new ParadexAuthError(res.status);
    if (!res.ok) throw new Error(`Paradex positions HTTP ${res.status}`);
    const parsed = ParadexPositionsResponseSchema.safeParse(await res.json());
    if (!parsed.success) throw new Error(`Paradex positions parse failed: ${parsed.error.message}`);
    const legs = paradexPositionsToLegs(parsed.data.results);
    this.latestLegs = legs;
    for (const listener of this.listeners) {
      try {
        listener(legs);
      } catch {}
    }
  }
}
