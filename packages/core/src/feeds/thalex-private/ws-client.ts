import type WebSocket from 'ws';
import type { PositionLeg } from '@oggregator/protocol';

import { feedLogger } from '../../utils/logger.js';
import { TopicWsClient } from '../shared/topic-ws-client.js';
import { mintAuthToken } from './auth.js';
import { thalexPortfolioToLegs } from './codec.js';
import {
  ThalexPortfolioNotificationSchema,
  type ThalexPortfolioEntry,
} from './types.js';

const PROD_WS_URL = 'wss://thalex.com/ws/api/v2';
const TEST_WS_URL = 'wss://testnet.thalex.com/ws/api/v2';
const PRIVATE_CHANNELS = ['account.portfolio'] as const;
const REQUEST_TIMEOUT_MS = 30_000;

export interface ThalexPrivateCreds {
  kid: string;
  privateKeyPem: string;
  account?: string;
  env?: 'prod' | 'test';
}

export type ThalexPositionsListener = (legs: PositionLeg[]) => void;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface JsonRpcEnvelope {
  id?: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
  channel_name?: string;
  notification?: unknown;
}

export class ThalexPrivateClient {
  private readonly client: TopicWsClient;
  private readonly listeners = new Set<ThalexPositionsListener>();
  private readonly pending = new Map<number, PendingRequest>();
  private latestLegs: PositionLeg[] = [];
  private latestEntries: ThalexPortfolioEntry[] = [];
  private nextId = 1;
  private disposed = false;
  private readonly log = feedLogger('thalex-private');

  private firstLoginResolved = false;

  constructor(private readonly creds: ThalexPrivateCreds) {
    const url = creds.env === 'test' ? TEST_WS_URL : PROD_WS_URL;
    this.client = new TopicWsClient(url, 'thalex-private', {
      onMessage: (raw) => this.handleRawMessage(raw),
      onStatusChange: (state) => {
        if (state === 'connected' && this.firstLoginResolved) {
          void this.bootstrap().catch((err) => {
            this.log.warn({ err: String(err) }, 'thalex reconnect bootstrap failed');
          });
        }
      },
      onClose: () => this.rejectAllPending('connection closed'),
    });
  }

  async start(): Promise<void> {
    await this.client.connect();
    await this.bootstrap();
    this.firstLoginResolved = true;
  }

  private async bootstrap(): Promise<void> {
    if (this.disposed) return;
    await this.login();
    await this.privateSubscribe([...PRIVATE_CHANNELS]);
    this.log.info({ channels: PRIVATE_CHANNELS.length }, 'thalex private subscribed');
  }

  subscribe(listener: ThalexPositionsListener): () => void {
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

  async dispose(): Promise<void> {
    this.disposed = true;
    this.listeners.clear();
    this.rejectAllPending('disposed');
    await this.client.disconnect();
  }

  private async login(): Promise<void> {
    let token: string;
    try {
      token = mintAuthToken({ kid: this.creds.kid, privateKeyPem: this.creds.privateKeyPem });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`thalex auth: failed to mint JWT (${msg}). Check kid and RSA private key PEM.`);
    }
    const params: Record<string, unknown> = { token };
    if (this.creds.account != null) params['account'] = this.creds.account;
    await this.call('public/login', params);
    this.log.info({ account: this.creds.account ?? 'default' }, 'thalex private login ok');
  }

  private async privateSubscribe(channels: string[]): Promise<void> {
    await this.call('private/subscribe', { channels });
  }

  private call(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (!this.client.isConnected) {
      return Promise.reject(new Error('[thalex-private] not connected'));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`[thalex-private] ${method} timed out`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.client.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  private rejectAllPending(reason: string): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(`[thalex-private] ${reason}`));
    }
    this.pending.clear();
  }

  private handleRawMessage(raw: WebSocket.RawData): void {
    let json: unknown;
    try {
      json = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (json == null || typeof json !== 'object') return;
    const msg = json as JsonRpcEnvelope;

    if (typeof msg.channel_name === 'string') {
      this.handleNotification(msg);
      return;
    }

    if (msg.id != null && typeof msg.id === 'number' && this.pending.has(msg.id)) {
      const entry = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      clearTimeout(entry.timer);
      if (msg.error != null) {
        entry.reject(
          new Error(`[thalex-private] RPC error ${msg.error.code}: ${msg.error.message}`),
        );
      } else {
        entry.resolve(msg.result);
      }
    }
  }

  private handleNotification(msg: JsonRpcEnvelope): void {
    if (msg.channel_name !== 'account.portfolio') return;
    const parsed = ThalexPortfolioNotificationSchema.safeParse(msg);
    if (!parsed.success) {
      this.log.warn({ err: parsed.error.message }, 'thalex portfolio notification parse failed');
      return;
    }
    this.applyPortfolio(parsed.data.notification, parsed.data.snapshot === true);
  }

  private applyPortfolio(entries: ThalexPortfolioEntry[], isSnapshot: boolean): void {
    const merged = isSnapshot ? entries : this.mergeEntries(this.latestEntries, entries);
    this.latestEntries = merged;
    const legs = thalexPortfolioToLegs(merged);
    this.latestLegs = legs;
    for (const listener of this.listeners) {
      try {
        listener(legs);
      } catch {}
    }
  }

  private mergeEntries(
    prev: ThalexPortfolioEntry[],
    incoming: ThalexPortfolioEntry[],
  ): ThalexPortfolioEntry[] {
    const map = new Map<string, ThalexPortfolioEntry>();
    for (const e of prev) map.set(e.instrument_name, e);
    for (const e of incoming) {
      if (e.position === 0) {
        map.delete(e.instrument_name);
      } else {
        map.set(e.instrument_name, e);
      }
    }
    return [...map.values()];
  }
}
