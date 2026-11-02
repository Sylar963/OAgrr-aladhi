import { onConnectionResume } from '@lib/connection-resume';
import { wsUrl } from '@lib/http';
import { type FlowTrade, InstrumentTradeWsServerMessageSchema } from '@oggregator/protocol';
import { useEffect, useRef, useState } from 'react';

const MAX_LIVE_TRADES = 2_000;

export interface InstrumentTradeStreamArgs {
  underlying: string;
  venue: string;
  instrument: string;
}

type ConnectionState = 'closed' | 'connecting' | 'open' | 'retrying';

export function useInstrumentTradesLive(args: InstrumentTradeStreamArgs, enabled: boolean) {
  const [trades, setTrades] = useState<FlowTrade[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionState>('closed');
  const retryRef = useRef(0);

  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    setTrades([]);

    if (!enabled || !args.underlying || !args.venue || !args.instrument) {
      setConnectionState('closed');
      return;
    }

    const open = () => {
      if (disposed) return;
      setConnectionState(retryRef.current === 0 ? 'connecting' : 'retrying');
      const params = new URLSearchParams({
        underlying: args.underlying,
        venue: args.venue,
        instrument: args.instrument,
      });
      const current = new WebSocket(`${wsUrl('/ws/instrument-trades')}?${params.toString()}`);
      socket = current;

      current.addEventListener('open', () => {
        if (disposed) return;
        setConnectionState('open');
      });

      current.addEventListener('message', (event) => {
        if (disposed || typeof event.data !== 'string') return;
        let value: unknown;
        try {
          value = JSON.parse(event.data);
        } catch {
          return;
        }
        const parsed = InstrumentTradeWsServerMessageSchema.safeParse(value);
        if (!parsed.success || parsed.data.type === 'error') return;
        if (parsed.data.type === 'snapshot') retryRef.current = 0;
        const incoming = parsed.data.type === 'snapshot' ? parsed.data.trades : [parsed.data.trade];
        setTrades((current) => mergeInstrumentTrades(current, incoming, MAX_LIVE_TRADES));
      });

      current.addEventListener('close', () => {
        if (disposed || socket !== current) return;
        setConnectionState('retrying');
        const delay = Math.min(1_000 * 2 ** retryRef.current + Math.random() * 500, 15_000);
        retryRef.current = Math.min(retryRef.current + 1, 5);
        retryTimer = setTimeout(open, delay);
      });

      current.addEventListener('error', () => current.close());
    };

    open();

    const stopResume = onConnectionResume(() => {
      if (retryTimer != null) clearTimeout(retryTimer);
      retryRef.current = 0;
      const stale = socket;
      socket = null;
      stale?.close();
      open();
    });

    return () => {
      disposed = true;
      stopResume();
      if (retryTimer != null) clearTimeout(retryTimer);
      socket?.close();
      retryRef.current = 0;
      setConnectionState('closed');
    };
  }, [args.instrument, args.underlying, args.venue, enabled]);

  return { trades, connectionState };
}

export function mergeInstrumentTrades(
  preferred: FlowTrade[],
  additional: FlowTrade[],
  limit = 500,
): FlowTrade[] {
  const byUid = new Map(additional.map((trade) => [trade.tradeUid, trade]));
  for (const trade of preferred) byUid.set(trade.tradeUid, trade);
  return Array.from(byUid.values())
    .sort((a, b) => b.timestamp - a.timestamp || b.tradeUid.localeCompare(a.tradeUid))
    .slice(0, limit);
}
