import {
  type AggregatedSpotCandle,
  isAggregatedSpotUnderlying,
  SpotCandleWsMessageSchema,
} from '@oggregator/protocol';
import type { IChartApi, ISeriesApi, Time } from 'lightweight-charts';
import { type RefObject, useEffect, useRef } from 'react';
import { onConnectionResume } from '@lib/connection-resume';
import { wsUrl } from '@lib/http';
import { LiveSpotOverlay, type OverlayCandle } from '@lib/live-spot-overlay';

function backoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** attempt + Math.random() * 500, 15_000);
}

interface UseLiveSpotOverlayArgs {
  chartRef: RefObject<IChartApi | null>;
  seriesRef: RefObject<ISeriesApi<'Candlestick', Time> | null>;
  /** Null, or a ticker without aggregated spot, leaves the chart as it is. */
  currency: string | null;
  resolutionSec: number;
  candles: readonly OverlayCandle[] | undefined;
  /** False while `candles` still belong to another timeframe or ticker. */
  ready?: boolean;
  futureWhitespace?: boolean;
  onBar?: (candle: AggregatedSpotCandle) => void;
}

/** Call after the effect that creates the chart: effects run in declaration order. */
export function useLiveSpotOverlay({
  chartRef,
  seriesRef,
  currency,
  resolutionSec,
  candles,
  ready = true,
  futureWhitespace = false,
  onBar,
}: UseLiveSpotOverlayArgs): void {
  const enabled = currency != null && isAggregatedSpotUnderlying(currency);
  const overlayRef = useRef<LiveSpotOverlay | null>(null);
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const onBarRef = useRef(onBar);
  onBarRef.current = onBar;

  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!enabled || !chart || !series) return;
    const overlay = new LiveSpotOverlay(chart, series, resolutionSec, futureWhitespace);
    overlayRef.current = overlay;
    return () => {
      overlayRef.current = null;
      // The chart's own cleanup runs first on unmount and clears its ref.
      overlay.dispose(chartRef.current === chart);
    };
  }, [enabled, resolutionSec, futureWhitespace, chartRef, seriesRef]);

  useEffect(() => {
    if (ready && candles) overlayRef.current?.setHistory(candles);
  }, [candles, ready, enabled, resolutionSec]);

  useEffect(() => {
    if (!enabled || currency == null) return;
    const url = new URL(wsUrl('/ws/spot-candles'));
    url.searchParams.set('currency', currency);
    url.searchParams.set('resolution', String(resolutionSec));

    let socket: WebSocket | null = null;
    let attempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const close = () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      if (!socket) return;
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.close(1000, 'unmount');
      socket = null;
    };

    const connect = () => {
      const ws = new WebSocket(url);
      socket = ws;
      ws.onopen = () => {
        attempt = 0;
      };
      ws.onmessage = (event: MessageEvent) => {
        let json: unknown;
        try {
          json = JSON.parse(event.data as string);
        } catch {
          return;
        }
        const message = SpotCandleWsMessageSchema.safeParse(json);
        if (!message.success || message.data.type !== 'bar' || !readyRef.current) return;
        overlayRef.current?.applyBar(message.data.candle);
        onBarRef.current?.(message.data.candle);
      };
      ws.onclose = () => {
        socket = null;
        reconnectTimer = setTimeout(connect, backoffMs(attempt));
        attempt += 1;
      };
    };

    connect();
    const stopResume = onConnectionResume(() => {
      close();
      connect();
    });
    return () => {
      stopResume();
      close();
    };
  }, [enabled, currency, resolutionSec]);
}
