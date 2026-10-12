import { describe, expect, it } from 'vitest';

import { chatReducer, INITIAL_CHAT_STATE } from './useSocialChat';

const message = (id: string) => ({
  id,
  alias: 'anon-abc123',
  isAnon: true,
  body: id,
  createdAt: '2026-10-12T12:00:00.000Z',
  mine: false,
});

describe('chatReducer', () => {
  it('goes live on hello and applies history, messages and deletions', () => {
    let state = chatReducer(INITIAL_CHAT_STATE, {
      type: 'server',
      message: {
        type: 'hello',
        room: 'global',
        online: 3,
        handle: null,
        anonAlias: 'anon-abc123',
        mutedUntil: null,
      },
    });
    expect(state.connection).toBe('live');
    state = chatReducer(state, {
      type: 'server',
      message: { type: 'history', messages: [message('a'), message('b')] },
    });
    state = chatReducer(state, {
      type: 'server',
      message: { type: 'message', message: message('c') },
    });
    state = chatReducer(state, { type: 'server', message: { type: 'deleted', id: 'b' } });
    expect(state.messages.map((m) => m.id)).toEqual(['a', 'c']);
  });
});
