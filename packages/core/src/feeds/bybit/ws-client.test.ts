import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CachedInstrument } from '../shared/sdk-base.js';
import type { TopicWsClientOptions } from '../shared/topic-ws-client.js';

type Frame = { op: string; args: string[] };

const fakeClients: FakeTopicWsClient[] = [];

class FakeTopicWsClient {
  readonly sent: Frame[] = [];
  readonly replayed: Frame[] = [];
  connected = false;

  constructor(
    readonly url: string,
    readonly label: string,
    readonly options: TopicWsClientOptions,
  ) {
    fakeClients.push(this);
  }

  get isConnected(): boolean {
    return this.connected;
  }
  get lastActivityAtMs(): number {
    return 1;
  }
  get connectedAtMs(): number {
    return 1;
  }

  async connect(): Promise<void> {
    this.connected = true;
    this.replayed.push(...((this.options.getReplayMessages?.() ?? []) as Frame[]));
    this.options.onStatusChange?.('connected');
  }
  send(payload: Frame): void {
    this.sent.push(payload);
  }
  terminate(): void {}
  async disconnect(): Promise<void> {
    this.connected = false;
  }
  receive(json: unknown): void {
    this.options.onMessage?.(Buffer.from(JSON.stringify(json)));
  }
}

vi.mock('../shared/topic-ws-client.js', () => ({ TopicWsClient: FakeTopicWsClient }));

const { BybitWsAdapter } = await import('./ws-client.js');

class TestBybitAdapter extends BybitWsAdapter {
  add(instruments: CachedInstrument[]): void {
    for (const inst of instruments) {
      this.instruments.push(inst);
      this.instrumentMap.set(inst.exchangeSymbol, inst);
    }
  }
  sub(instruments: CachedInstrument[]): Promise<void> {
    return this.subscribeChain('BTC', '2026-12-25', instruments);
  }
  unsub(instruments: CachedInstrument[]): Promise<void> {
    return this.unsubscribeChain('BTC', '2026-12-25', instruments);
  }
}

function option(strike: number, right: 'C' | 'P' = 'C'): CachedInstrument {
  return {
    symbol: `BTC/USDT:USDT-261225-${strike}-${right}`,
    exchangeSymbol: `BTC-25DEC26-${strike}-${right}-USDT`,
    base: 'BTC',
    quote: 'USDT',
    settle: 'USDT',
    expiry: '2026-12-25',
    strike,
    right: right === 'C' ? 'call' : 'put',
    inverse: false,
    contractSize: 1,
    tickSize: 5,
    minQty: 0.01,
    makerFee: 0.0002,
    takerFee: 0.0005,
  };
}

const replayTopics = (client: FakeTopicWsClient) => client.replayed.flatMap((f) => f.args);

describe('BybitWsAdapter subscription sharding', () => {
  beforeEach(() => {
    fakeClients.length = 0;
  });

  it('splits topics across connections at the documented 2000-args-per-connection cap', async () => {
    const adapter = new TestBybitAdapter();
    const instruments = Array.from({ length: 2_500 }, (_, i) => option(10_000 + i * 100));
    adapter.add(instruments);

    await adapter.sub(instruments);

    expect(fakeClients.map((c) => c.label)).toEqual(['bybit-ws', 'bybit-ws-1']);
    expect(replayTopics(fakeClients[0]!)).toHaveLength(2_000);
    expect(replayTopics(fakeClients[1]!)).toHaveLength(500);
    expect(fakeClients[0]!.replayed.every((f) => f.op === 'subscribe' && f.args.length <= 200)).toBe(
      true,
    );
    // New sockets get topics via replay only — no duplicate subscribe frames.
    expect(fakeClients.flatMap((c) => c.sent)).toEqual([]);

    const extra = [option(900_000)];
    adapter.add(extra);
    await adapter.sub(extra);
    expect(fakeClients[1]!.sent).toEqual([
      { op: 'subscribe', args: ['tickers.BTC-25DEC26-900000-C-USDT'] },
    ]);
  });

  it('sends unsubscribes to the shard that owns the topic', async () => {
    const adapter = new TestBybitAdapter();
    const instruments = Array.from({ length: 2_001 }, (_, i) => option(10_000 + i * 100));
    adapter.add(instruments);
    await adapter.sub(instruments);

    await adapter.unsub([instruments[0]!, instruments[2_000]!]);

    expect(fakeClients[0]!.sent).toEqual([
      { op: 'unsubscribe', args: ['tickers.BTC-25DEC26-10000-C-USDT'] },
    ]);
    expect(fakeClients[1]!.sent).toEqual([
      { op: 'unsubscribe', args: ['tickers.BTC-25DEC26-210000-C-USDT'] },
    ]);
  });

  it('drops topics the venue rejects so reconnect replay stops resending them', async () => {
    const adapter = new TestBybitAdapter();
    const instruments = [option(100_000), option(110_000)];
    adapter.add(instruments);
    await adapter.sub(instruments);
    const client = fakeClients[0]!;

    // Shape captured from wss://stream.bybit.com/v5/public/option (2026-10-04).
    client.receive({
      success: true,
      conn_id: 'dat43eb07optjqfk6030-vumr',
      data: {
        successTopics: ['tickers.BTC-25DEC26-100000-C-USDT'],
        failTopics: ['tickers.BTC-25DEC26-110000-C-USDT'],
      },
      type: 'COMMAND_RESP',
    });

    client.replayed.length = 0;
    client.connected = false;
    await client.connect();
    expect(replayTopics(client)).toEqual(['tickers.BTC-25DEC26-100000-C-USDT']);
  });

  it('treats a clean ack and option pongs as control frames, not ticker data', async () => {
    const adapter = new TestBybitAdapter();
    const instruments = [option(100_000)];
    adapter.add(instruments);
    await adapter.sub(instruments);
    const client = fakeClients[0]!;

    client.receive({ args: ['1791136071311'], op: 'pong' });
    client.receive({
      success: true,
      conn_id: 'x',
      data: { successTopics: ['tickers.BTC-25DEC26-100000-C-USDT'], failTopics: [] },
      type: 'COMMAND_RESP',
    });

    client.replayed.length = 0;
    client.connected = false;
    await client.connect();
    expect(replayTopics(client)).toEqual(['tickers.BTC-25DEC26-100000-C-USDT']);
  });
});
