import type { ChatMessageDto } from '@oggregator/protocol';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./hooks/queries', () => ({
  useSocialProfile: () => ({ data: { handle: 'me' } }),
}));

import ChatDock, { unreadCount } from './ChatDock';
import { INITIAL_CHAT_STATE } from './hooks/useSocialSocket';

function message(id: string, createdAt: number, mine = false): ChatMessageDto {
  return { id, alias: 'anon', isAnon: true, body: `msg ${id}`, createdAt: new Date(createdAt).toISOString(), mine };
}

afterEach(cleanup);

describe('unreadCount', () => {
  it('counts only messages from others posted after the last look', () => {
    const messages = [message('1', 1_000), message('2', 3_000), message('3', 4_000, true), message('4', 5_000)];
    expect(unreadCount(messages, 2_000)).toBe(2);
    expect(unreadCount(messages, 5_000)).toBe(0);
  });
});

describe('ChatDock', () => {
  it('starts as a bottom tab, badges new messages, opens on click and closes on Escape', () => {
    const state = { ...INITIAL_CHAT_STATE, connection: 'live' as const, online: 7 };
    const props = { send: vi.fn(() => true), reconnect: vi.fn() };
    const { rerender } = render(<ChatDock state={{ ...state, messages: [message('old', 0)] }} {...props} />);

    expect(screen.getByRole('button', { name: 'Open global chat' }).textContent).toContain('7 online');
    expect(screen.queryByPlaceholderText('Message global chat…')).toBeNull();

    rerender(<ChatDock state={{ ...state, messages: [message('old', 0), message('new', Date.now() + 1_000)] }} {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open global chat, 1 new' }));
    expect(screen.getByPlaceholderText('Message global chat…')).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Open global chat' })).toBeTruthy();
  });
});
