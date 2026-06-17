/**
 * @vitest-environment jsdom
 */
import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  sent: string[] = [];
  constructor(public url: string) {
    MockWebSocket.instances.push(this);
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.();
    }, 0);
  }
  send(data: string) { this.sent.push(data); }
  close() { this.readyState = 3; }
  pushMessage(msg: unknown) { this.onmessage?.({ data: JSON.stringify(msg) }); }
  static reset() { MockWebSocket.instances = []; }
}

vi.stubGlobal('WebSocket', MockWebSocket);

const { useTradfiUnderlyingCandlesLive } = await import('./use-tradfi-underlying-candles-live');

beforeEach(() => {
  vi.useFakeTimers();
  MockWebSocket.reset();
});
afterEach(() => {
  vi.useRealTimers();
});

function bar(ts: number, c: number) {
  return { type: 'bar', ts, o: c, h: c, l: c, c, vol: 1 };
}

describe('useTradfiUnderlyingCandlesLive', () => {
  it('opens a socket with the underlying + interval in the URL', async () => {
    renderHook(() => useTradfiUnderlyingCandlesLive({ underlying: 'SPX', interval: '5m', onBar: () => {} }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0]!.url).toContain('/ws/underlying-candles?underlying=SPX&interval=5m');
  });

  it('calls onBar for a valid bar message and ignores invalid messages', async () => {
    const seen: number[] = [];
    renderHook(() => useTradfiUnderlyingCandlesLive({ underlying: 'SPX', interval: '5m', onBar: (b) => seen.push(b.c) }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    const ws = MockWebSocket.instances[0]!;
    await act(() => { ws.pushMessage(bar(1781553000000, 56.5)); });
    await act(() => { ws.pushMessage({ type: 'noise' }); });
    expect(seen).toEqual([56.5]);
  });

  it('does not connect when disabled or when underlying is empty', async () => {
    renderHook(() => useTradfiUnderlyingCandlesLive({ underlying: 'SPX', interval: '5m', enabled: false, onBar: () => {} }));
    renderHook(() => useTradfiUnderlyingCandlesLive({ underlying: '', interval: '5m', onBar: () => {} }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it('reconnects after the socket closes', async () => {
    renderHook(() => useTradfiUnderlyingCandlesLive({ underlying: 'SPX', interval: '5m', onBar: () => {} }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    const ws = MockWebSocket.instances[0]!;
    await act(() => { ws.onclose?.(); });
    await act(() => vi.advanceTimersByTimeAsync(1600)); // backoff for attempt 0 (<=1500ms)
    expect(MockWebSocket.instances.length).toBe(2);
  });

  it('tears down on unmount without reconnecting', async () => {
    const { unmount } = renderHook(() => useTradfiUnderlyingCandlesLive({ underlying: 'SPX', interval: '5m', onBar: () => {} }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(MockWebSocket.instances).toHaveLength(1);
  });
});
