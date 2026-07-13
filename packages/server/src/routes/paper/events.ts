import type {
  PaperActivityDto,
  PaperFillDto,
  PaperOrderDto,
  PaperTradeDetailDto,
  PaperWsServerMessage,
} from '@oggregator/protocol';

export type PaperEventListener = (accountId: string, msg: PaperWsServerMessage) => void;

class PaperEventBus {
  private readonly listeners = new Set<PaperEventListener>();

  subscribe(listener: PaperEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emitOrder(order: PaperOrderDto, fills: PaperFillDto[]): void {
    this.broadcast(order.accountId, { type: 'order', order, fills });
  }

  emitTrade(trade: PaperTradeDetailDto): void {
    this.broadcast(trade.accountId, { type: 'trade', trade });
  }

  emitActivity(accountId: string, activity: PaperActivityDto): void {
    this.broadcast(accountId, { type: 'activity', activity });
  }

  private broadcast(accountId: string, msg: PaperWsServerMessage): void {
    for (const listener of this.listeners) {
      try {
        listener(accountId, msg);
      } catch {}
    }
  }
}

export const paperEvents = new PaperEventBus();
