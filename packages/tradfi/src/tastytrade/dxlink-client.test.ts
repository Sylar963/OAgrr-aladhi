import { describe, expect, it, vi } from 'vitest';
import { DxLinkProtocol, SUBSCRIBE_FRAME_INTERVAL_MS } from './dxlink-client.js';

describe('DxLinkProtocol state machine', () => {
  it('walks the handshake and emits subscribe after FEED_CONFIG', () => {
    const sent: unknown[] = [];
    const onData = vi.fn();
    const proto = new DxLinkProtocol({
      channel: 3,
      token: 'QT',
      send: (m) => sent.push(m),
      onData,
      desiredSubs: () => [{ type: 'Quote', symbol: '.AAPL200C' }],
    });

    proto.onOpen();
    expect((sent[0] as { type: string }).type).toBe('SETUP');

    proto.onMessage({ type: 'AUTH_STATE', channel: 0, state: 'UNAUTHORIZED' });
    expect((sent[1] as { type: string }).type).toBe('AUTH');

    proto.onMessage({ type: 'AUTH_STATE', channel: 0, state: 'AUTHORIZED' });
    expect((sent[2] as { type: string }).type).toBe('CHANNEL_REQUEST');

    proto.onMessage({ type: 'CHANNEL_OPENED', channel: 3 });
    expect((sent[3] as { type: string }).type).toBe('FEED_SETUP');

    proto.onMessage({ type: 'FEED_CONFIG', channel: 3 });
    expect((sent[4] as { type: string }).type).toBe('FEED_SUBSCRIPTION');
    expect(proto.isReady()).toBe(true);
  });

  it('routes FEED_DATA to onData', () => {
    const onData = vi.fn();
    const proto = new DxLinkProtocol({ channel: 3, token: 'QT', send: () => {}, onData, desiredSubs: () => [] });
    proto.onMessage({ type: 'FEED_DATA', channel: 3, data: ['Trade', ['Trade', 'AAPL', 1, 2, 3]] });
    expect(onData).toHaveBeenCalledTimes(1);
  });

  it('fires onAuthError when the token is rejected (UNAUTHORIZED after AUTH)', () => {
    const onAuthError = vi.fn();
    const proto = new DxLinkProtocol({ channel: 3, token: 'QT', send: () => {}, onData: () => {}, desiredSubs: () => [], onAuthError });
    proto.onOpen();
    proto.onMessage({ type: 'AUTH_STATE', state: 'UNAUTHORIZED' }); // first → sends AUTH
    expect(onAuthError).not.toHaveBeenCalled();
    proto.onMessage({ type: 'AUTH_STATE', state: 'UNAUTHORIZED' }); // re-prompt → token rejected
    expect(onAuthError).toHaveBeenCalledTimes(1);
  });

  it('fires onAuthError on an UNAUTHORIZED ERROR frame', () => {
    const onAuthError = vi.fn();
    const proto = new DxLinkProtocol({ channel: 3, token: 'QT', send: () => {}, onData: () => {}, desiredSubs: () => [], onAuthError });
    proto.onMessage({ type: 'ERROR', error: 'UNAUTHORIZED', message: 'bad token' });
    expect(onAuthError).toHaveBeenCalledTimes(1);
  });

  it('does NOT reconnect on non-auth ERROR frames (no storm)', () => {
    const onAuthError = vi.fn();
    const proto = new DxLinkProtocol({ channel: 3, token: 'QT', send: () => {}, onData: () => {}, desiredSubs: () => [], onAuthError });
    proto.onMessage({ type: 'ERROR', error: 'INVALID_MESSAGE' });
    proto.onMessage({ type: 'ERROR', error: 'TIMEOUT' });
    expect(onAuthError).not.toHaveBeenCalled();
  });

  it('sends the full subscription set once per connection, split under the frame limit and paced', () => {
    vi.useFakeTimers();
    try {
      const sent: Array<{ type: string; add?: unknown[] }> = [];
      const desired = Array.from({ length: 5_000 }, (_, i) => ({
        type: 'Greeks' as const,
        symbol: `.AAOI261016C${i}`,
      }));
      const proto = new DxLinkProtocol({
        channel: 3,
        token: 'QT',
        send: (m) => sent.push(m as { type: string; add?: unknown[] }),
        onData: vi.fn(),
        desiredSubs: () => desired,
      });
      proto.onOpen();
      proto.onMessage({ type: 'FEED_CONFIG', channel: 3 });
      proto.onMessage({ type: 'FEED_CONFIG', channel: 3 });

      const frames = () => sent.filter((m) => m.type === 'FEED_SUBSCRIPTION');
      expect(frames()).toHaveLength(1);
      vi.advanceTimersByTime(SUBSCRIBE_FRAME_INTERVAL_MS);
      expect(frames()).toHaveLength(2);

      vi.runAllTimers();
      expect(frames().length).toBe(10);
      expect(frames().every((f) => JSON.stringify(f).length < 65_536)).toBe(true);
      expect(frames().flatMap((f) => f.add ?? [])).toEqual(desired);
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops queued frames when the connection reopens', () => {
    vi.useFakeTimers();
    try {
      const sent: Array<{ type: string }> = [];
      const desired = Array.from({ length: 2_000 }, (_, i) => ({ type: 'Greeks' as const, symbol: `.X${i}` }));
      const proto = new DxLinkProtocol({
        channel: 3, token: 'QT', send: (m) => sent.push(m as { type: string }), onData: vi.fn(),
        desiredSubs: () => desired,
      });
      proto.onMessage({ type: 'FEED_CONFIG', channel: 3 });
      proto.onOpen();
      vi.runAllTimers();
      expect(sent.filter((m) => m.type === 'FEED_SUBSCRIPTION')).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports subscription rejections without treating them as auth errors', () => {
    const onAuthError = vi.fn();
    const onSubscriptionRejected = vi.fn();
    const proto = new DxLinkProtocol({
      channel: 3, token: 'QT', send: () => {}, onData: () => {}, desiredSubs: () => [],
      onAuthError, onSubscriptionRejected,
    });
    proto.onMessage({ type: 'ERROR', error: 'BAD_ACTION', message: 'Your subscription size is too big' });
    proto.onMessage({ type: 'ERROR', error: 'BAD_ACTION', message: 'Some other action problem' });
    expect(onSubscriptionRejected).toHaveBeenCalledTimes(1);
    expect(onSubscriptionRejected).toHaveBeenCalledWith('Your subscription size is too big');
    expect(onAuthError).not.toHaveBeenCalled();
  });
});
