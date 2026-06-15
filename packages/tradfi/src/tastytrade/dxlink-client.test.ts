import { describe, expect, it, vi } from 'vitest';
import { DxLinkProtocol } from './dxlink-client.js';

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
});
