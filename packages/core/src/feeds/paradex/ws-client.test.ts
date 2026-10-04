import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CachedInstrument, LiveQuote } from '../shared/sdk-base.js';
import type { TopicWsClientOptions } from '../shared/topic-ws-client.js';

type RpcFrame = { jsonrpc: '2.0'; id: number; method: string; params: { channel: string } };

const fakeClients: FakeTopicWsClient[] = [];

class FakeTopicWsClient {
  readonly sent: RpcFrame[] = [];
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
    this.options.onStatusChange?.('connected');
    await this.options.onOpen?.();
  }
  send(payload: RpcFrame): void {
    this.sent.push(payload);
  }
  terminate(): void {}
  async disconnect(): Promise<void> {
    this.connected = false;
  }
  drop(): void {
    this.connected = false;
    this.options.onClose?.();
    this.options.onStatusChange?.('reconnecting');
  }
  receive(raw: Buffer): void {
    this.options.onMessage?.(raw);
  }
}

vi.mock('../shared/topic-ws-client.js', () => ({ TopicWsClient: FakeTopicWsClient }));

const { ParadexWsAdapter } = await import('./ws-client.js');

class TestParadexAdapter extends ParadexWsAdapter {
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
  quote(symbol: string): LiveQuote | undefined {
    return this.quoteStore.get(symbol);
  }
}

function option(strike: number): CachedInstrument {
  return {
    symbol: `BTC/USD:USDC-261225-${strike}-C`,
    exchangeSymbol: `BTC-USD-25DEC26-${strike}-C`,
    base: 'BTC',
    quote: 'USD',
    settle: 'USDC',
    expiry: '2026-12-25',
    strike,
    right: 'call',
    inverse: false,
    contractSize: 1,
    tickSize: 0.01,
    minQty: 0.001,
    makerFee: 0.0003,
    takerFee: 0.0003,
  };
}

// markets_summary.BTC-USD-25DEC26-100000-C frame, schema 1 v1, captured 2026-10-04.
const BTC_100K_CALL_FRAME = Buffer.from(
  'f000040001000100189dbb88075d060000000000000000008c482bd22a00000049f90f27c207000000ee64d02700000000000000000000008040bf65010000000000000000000000c05f74372a000000806a7f282c000000a1e1e6dad24c01006c7f3700000000005378390200000000c30e360200000000c562400200000000000000000000008096165e0100000000e80700000000000048137fdc020000002c6d7448fffffffff16f7fe7ffffffff6d209c0d00000000528cfaffffffffff7c230000000000000000000000000080a086010000000000a08601000000000099664c000000000000000000000000000000000000000080184254432d5553442d323544454332362d3130303030302d43',
  'hex',
);

const channels = (frames: RpcFrame[], method = 'subscribe') =>
  frames.filter((f) => f.method === method).map((f) => f.params.channel);

describe('ParadexWsAdapter per-market shards', () => {
  beforeEach(() => {
    fakeClients.length = 0;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shards per-market channels under the 200/connection cap and paces subscribe frames', async () => {
    const adapter = new TestParadexAdapter();
    const instruments = Array.from({ length: 400 }, (_, i) => option(50_000 + i * 500));
    adapter.add(instruments);

    await adapter.sub(instruments);
    await vi.advanceTimersByTimeAsync(0);

    expect(fakeClients.map((c) => c.label)).toEqual(['paradex-ws', 'paradex-ws-1', 'paradex-ws-2']);
    // 5 frames per 100ms tick: never a burst that trips 4032 "inbound queue full".
    expect(fakeClients[0]!.sent).toHaveLength(5);

    await vi.advanceTimersByTimeAsync(10_000);
    const perShard = fakeClients.map((c) => channels(c.sent).length);
    expect(perShard).toEqual([195, 195, 10]);
    expect(perShard.every((n) => n <= 200)).toBe(true);
    expect(channels(fakeClients[0]!.sent)[0]).toBe('markets_summary.BTC-USD-25DEC26-50000-C');
    expect(fakeClients[0]!.sent[0]).toMatchObject({ jsonrpc: '2.0', method: 'subscribe' });
  });

  it('replays the shard allocation on reconnect', async () => {
    const adapter = new TestParadexAdapter();
    const instruments = [option(100_000), option(110_000)];
    adapter.add(instruments);
    await adapter.sub(instruments);
    await vi.advanceTimersByTimeAsync(1_000);
    const client = fakeClients[0]!;

    client.drop();
    client.sent.length = 0;
    await client.connect();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(channels(client.sent)).toEqual([
      'markets_summary.BTC-USD-25DEC26-100000-C',
      'markets_summary.BTC-USD-25DEC26-110000-C',
    ]);
  });

  it('routes SBE market-summary frames into the quote store', async () => {
    const adapter = new TestParadexAdapter();
    const instruments = [option(100_000)];
    adapter.add(instruments);
    await adapter.sub(instruments);

    fakeClients[0]!.receive(BTC_100K_CALL_FRAME);

    const quote = adapter.quote('BTC-USD-25DEC26-100000-C');
    expect(quote?.bidPrice).toBeCloseTo(1813.19);
    expect(quote?.askPrice).toBeCloseTo(1896.58);
    expect(quote?.greeks.delta).toBeCloseTo(0.22943382);
    expect(quote?.greeks.markIv).toBeCloseTo(0.37320787);
  });

  it('releases a channel the venue rejects at the subscription cap', async () => {
    const adapter = new TestParadexAdapter();
    const instruments = [option(100_000), option(110_000)];
    adapter.add(instruments);
    await adapter.sub(instruments);
    await vi.advanceTimersByTimeAsync(1_000);
    const client = fakeClients[0]!;
    const rejected = client.sent[1]!;

    // Error body captured live when subscribing a 201st market on one socket.
    client.receive(
      Buffer.from(
        JSON.stringify({
          jsonrpc: '2.0',
          id: rejected.id,
          error: {
            code: 42900,
            message: 'max subscriptions per connection reached',
            data: 'limit: 200',
          },
          usIn: 1791136418760041,
          usDiff: 50,
          usOut: 1791136418760091,
        }),
      ),
    );

    client.drop();
    client.sent.length = 0;
    await client.connect();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(channels(client.sent)).toEqual(['markets_summary.BTC-USD-25DEC26-100000-C']);
  });

  it('unsubscribes released chains and cancels their queued subscribes', async () => {
    const adapter = new TestParadexAdapter();
    const instruments = Array.from({ length: 12 }, (_, i) => option(50_000 + i * 500));
    adapter.add(instruments);
    await adapter.sub(instruments);
    const client = fakeClients[0]!;
    expect(channels(client.sent)).toHaveLength(5);

    await adapter.unsub(instruments.slice(10));
    await vi.advanceTimersByTimeAsync(1_000);

    expect(channels(client.sent)).toHaveLength(10);
    expect(channels(client.sent, 'unsubscribe')).toEqual([
      'markets_summary.BTC-USD-25DEC26-55000-C',
      'markets_summary.BTC-USD-25DEC26-55500-C',
    ]);
  });
});
