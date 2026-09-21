import { describe, expect, it } from 'vitest';
import {
  consumeWebSocketTicket,
  invalidateWebSocketTicketsForUser,
  issueWebSocketTicket,
} from './websocket-ticket-service.js';

const user = { id: 'usr_1', clerkUserId: 'user_1', accountId: 'acct_1', label: 'Trader' };

describe('websocket tickets', () => {
  it('can be consumed exactly once', () => {
    const issued = issueWebSocketTicket(user);

    expect(consumeWebSocketTicket(issued.ticket)).toEqual(user);
    expect(consumeWebSocketTicket(issued.ticket)).toBeNull();
  });

  it('rejects missing tickets', () => {
    expect(consumeWebSocketTicket(null)).toBeNull();
  });
  it('revokes unconsumed tickets when the user signs out', () => {
    const issued = issueWebSocketTicket(user);

    invalidateWebSocketTicketsForUser(user.id);

    expect(consumeWebSocketTicket(issued.ticket)).toBeNull();
  });
});
