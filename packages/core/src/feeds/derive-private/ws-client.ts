import { feedLogger } from '../../utils/logger.js';
import { JsonRpcWsClient } from '../shared/jsonrpc-client.js';
import { signLoginMessage } from './auth.js';
import { derivePositionsToLegs, deriveTradesToPortfolioTrades } from './codec.js';
import {
  DerivePositionsResponseSchema,
  DeriveTradeHistoryResponseSchema,
  type DerivePosition,
  type DeriveTrade,
} from './types.js';
import type { ExchangePortfolioTrade, PositionLeg } from '@oggregator/protocol';

const DERIVE_WS_URL = 'wss://api.lyra.finance/ws';
const DERIVE_TESTNET_WS_URL = 'wss://api-demo.lyra.finance/ws';

export interface DerivePrivateCreds {
  walletAddress: string;
  signerPrivateKey: string;
  subaccountId: number;
  env?: 'prod' | 'test';
}

export type DerivePositionsListener = (legs: PositionLeg[]) => void;
export type DeriveTradesListener = (trades: ExchangePortfolioTrade[]) => void;

export class DerivePrivateClient {
  private readonly client: JsonRpcWsClient;
  private readonly listeners = new Set<DerivePositionsListener>();
  private readonly tradeListeners = new Set<DeriveTradesListener>();
  private latestLegs: PositionLeg[] = [];
  private latestTrades: ExchangePortfolioTrade[] = [];
  private refreshInFlight: Promise<void> | null = null;
  private tradeRefreshInFlight: Promise<void> | null = null;
  private disposed = false;
  private readonly log = feedLogger('derive-private');

  constructor(private readonly creds: DerivePrivateCreds) {
    const url = creds.env === 'test' ? DERIVE_TESTNET_WS_URL : DERIVE_WS_URL;
    this.client = new JsonRpcWsClient(url, 'derive-private', {
      subscribeMethod: 'subscribe',
      unsubscribeMethod: 'unsubscribe',
      heartbeatIntervalSec: 30,
      onStatusChange: (state) => {
        if (state === 'connected') {
          void this.afterReconnect();
        }
      },
    });
    this.client.onSubscription((channel, _data) => {
      if (channel === this.balanceChannel()) {
        void Promise.allSettled([this.refreshPositions(), this.refreshTradeHistory()]);
      }
    });
  }

  async start(): Promise<void> {
    await this.client.connect();
    await this.login();
    await this.client.subscribe([this.balanceChannel()], 'derive-private');
    await Promise.all([this.refreshPositions(), this.refreshTradeHistory()]);
  }

  subscribe(listener: DerivePositionsListener): () => void {
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

  subscribeTrades(listener: DeriveTradesListener): () => void {
    this.tradeListeners.add(listener);
    if (this.latestTrades.length > 0) {
      try {
        listener(this.latestTrades);
      } catch {}
    }
    return () => {
      this.tradeListeners.delete(listener);
    };
  }

  getLatestLegs(): PositionLeg[] {
    return [...this.latestLegs];
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.listeners.clear();
    await this.client.disconnect();
    this.tradeListeners.clear();
  }

  private balanceChannel(): string {
    return `${this.creds.subaccountId}.balances`;
  }

  private async login(): Promise<void> {
    const params = signLoginMessage({
      walletAddress: this.creds.walletAddress,
      signerPrivateKey: this.creds.signerPrivateKey,
    });
    await this.client.call('public/login', { ...params });
    this.log.info({ subaccount: this.creds.subaccountId }, 'derive private login ok');
  }

  private async afterReconnect(): Promise<void> {
    if (this.disposed) return;
    try {
      await this.login();
      await this.client.subscribe([this.balanceChannel()], 'derive-reconnect');
      await Promise.all([this.refreshPositions(), this.refreshTradeHistory()]);
    } catch (err) {
      this.log.warn({ err: String(err) }, 'derive private reconnect failed');
    }
  }

  private async refreshPositions(): Promise<void> {
    if (this.refreshInFlight != null) return this.refreshInFlight;
    this.refreshInFlight = (async () => {
      try {
        const raw = await this.client.call('private/get_positions', {
          subaccount_id: this.creds.subaccountId,
        });
        const parsed = DerivePositionsResponseSchema.safeParse(raw);
        if (!parsed.success) {
          this.log.warn({ err: parsed.error.message }, 'derive positions parse failed');
          return;
        }
        const legs = derivePositionsToLegs(parsed.data.positions as DerivePosition[]);
        this.latestLegs = legs;
        for (const listener of this.listeners) {
          try {
            listener(legs);
          } catch {}
        }
      } catch (err) {
        this.log.warn({ err: String(err) }, 'derive positions refresh failed');
      } finally {
        this.refreshInFlight = null;
      }
    })();
    return this.refreshInFlight;
  }

  private async refreshTradeHistory(): Promise<void> {
    if (this.tradeRefreshInFlight != null) return this.tradeRefreshInFlight;
    this.tradeRefreshInFlight = (async () => {
      try {
        const trades: DeriveTrade[] = [];
        let totalPages = 1;
        for (let page = 1; page <= Math.min(totalPages, 100); page += 1) {
          const raw = await this.client.call('private/get_trade_history', {
            subaccount_id: this.creds.subaccountId,
            page,
            page_size: 1_000,
          });
          const parsed = DeriveTradeHistoryResponseSchema.safeParse(raw);
          if (!parsed.success) {
            this.log.warn({ err: parsed.error.message }, 'derive trade history parse failed');
            return;
          }
          trades.push(...parsed.data.trades);
          totalPages = Math.max(1, parsed.data.pagination.num_pages);
        }
        const normalized = deriveTradesToPortfolioTrades(trades);
        this.latestTrades = normalized;
        this.notifyTrades(normalized);
        this.log.info(
          { trades: trades.length, optionTrades: normalized.length },
          'derive private trade history refresh ok',
        );
      } catch (err) {
        this.log.warn({ err: String(err) }, 'derive trade history refresh failed');
      } finally {
        this.tradeRefreshInFlight = null;
      }
    })();
    return this.tradeRefreshInFlight;
  }

  private notifyTrades(trades: ExchangePortfolioTrade[]): void {
    for (const listener of this.tradeListeners) {
      try {
        listener(trades);
      } catch {}
    }
  }
}
