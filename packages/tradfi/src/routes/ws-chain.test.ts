import { describe, expect, it } from 'vitest';
import { ChainPusher } from './ws-chain.js';
import { TradfiStore } from '../runtime/store.js';

describe('ChainPusher', () => {
  it('pushes an enriched snapshot on tick', () => {
    const store = new TradfiStore();
    const sent: string[] = [];
    const pusher = new ChainPusher(store, (s) => sent.push(s), 'AAPL', '2026-04-17');
    pusher.tick();
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]!).underlying).toBe('AAPL');
  });

  it('stops after dispose', () => {
    const store = new TradfiStore();
    const sent: string[] = [];
    const pusher = new ChainPusher(store, (s) => sent.push(s), 'AAPL', '2026-04-17');
    pusher.dispose();
    pusher.tick();
    expect(sent).toHaveLength(0);
  });
});
