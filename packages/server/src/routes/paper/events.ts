import type { PaperFillDto, PaperOrderDto, PaperWsServerMessage } from '@oggregator/protocol';

export type PaperEventListener = (msg: PaperWsServerMessage) => void;

class PaperEventBus {
  private readonly listeners = new Set<PaperEventListener>();

  subscribe(listener: PaperEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emitOrder(order: PaperOrderDto, fills: PaperFillDto[]): void {
    this.broadcast({ type: 'order', order, fills });
  }

  private broadcast(msg: PaperWsServerMessage): void {
    for (const listener of this.listeners) {
      try {
        listener(msg);
      } catch {}
    }
  }
}

export const paperEvents = new PaperEventBus();
