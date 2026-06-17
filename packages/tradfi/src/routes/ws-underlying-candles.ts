import { InstrumentCandleIntervalSchema } from '@oggregator/protocol';
import type { FastifyInstance } from 'fastify';
import type { TradfiDeps } from '../app.js';
import { mapRawCandle } from '../runtime/candles.js';
import { intervalToPeriod, type RawCandle } from '../tastytrade/candle-codec.js';

const FLUSH_INTERVAL_MS = 200;

// Recent window the live subscription replays before streaming; scaled to the
// interval so it always includes the current forming bar. The full history
// still comes from the REST /underlying-candles snapshot.
const INTERVAL_TO_SECONDS: Record<string, number> = {
  '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400,
};

interface LiveBarMessage { type: 'bar'; ts: number; o: number; h: number; l: number; c: number; vol: number }

export class CandleStreamer {
  private disposed = false;
  private latest = new Map<number, LiveBarMessage>(); // keyed by bar ts; holds the latest state since last flush

  constructor(private readonly send: (data: string) => void) {}

  onBar(bar: RawCandle): void {
    if (this.disposed) return;
    const dto = mapRawCandle(bar);
    if (!dto) return;
    this.latest.set(dto.ts, { type: 'bar', ts: dto.ts, o: dto.o, h: dto.h, l: dto.l, c: dto.c, vol: dto.vol });
  }

  flush(): void {
    if (this.disposed || this.latest.size === 0) return;
    const bars = [...this.latest.values()].sort((a, b) => a.ts - b.ts);
    this.latest.clear();
    for (const b of bars) this.send(JSON.stringify(b));
  }

  dispose(): void {
    this.disposed = true;
    this.latest.clear();
  }
}

export function wsUnderlyingCandlesRoute(deps: TradfiDeps) {
  return async function (app: FastifyInstance) {
    app.get<{ Querystring: { underlying?: string; interval?: string } }>(
      '/ws/underlying-candles',
      { websocket: true },
      (socket, req) => {
        const { underlying, interval } = req.query;
        const i = InstrumentCandleIntervalSchema.safeParse(interval);
        if (!underlying || !i.success) {
          socket.send(JSON.stringify({ type: 'error', message: 'underlying and interval required' }));
          socket.close();
          return;
        }
        if (!deps.candleClient || !deps.candleClient.isReady()) {
          socket.send(JSON.stringify({ type: 'error', message: 'candle feed not ready' }));
          socket.close();
          return;
        }
        const period = intervalToPeriod(i.data);
        const windowSec = (INTERVAL_TO_SECONDS[i.data] ?? 300) * 3;
        const fromTime = Math.floor(Date.now() / 1000) - windowSec;
        const streamer = new CandleStreamer((d) => socket.send(d));
        const unsub = deps.candleClient.subscribeLive(underlying, period, fromTime, (bar) => streamer.onBar(bar));
        const timer = setInterval(() => streamer.flush(), FLUSH_INTERVAL_MS);
        socket.on('close', () => {
          clearInterval(timer);
          unsub();
          streamer.dispose();
        });
      },
    );
  };
}
