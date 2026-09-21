import type { AuthenticatedUser } from './user-service.js';

interface WebSocketTicket {
  user: AuthenticatedUser;
  expiresAt: number;
}

const TICKET_TTL_MS = 30_000;
const tickets = new Map<string, WebSocketTicket>();

export function issueWebSocketTicket(user: AuthenticatedUser): {
  ticket: string;
  expiresAt: number;
} {
  clearExpiredWebSocketTickets();
  const ticket = crypto.randomUUID();
  const expiresAt = Date.now() + TICKET_TTL_MS;
  tickets.set(ticket, { user, expiresAt });
  return { ticket, expiresAt };
}

export function consumeWebSocketTicket(ticket: string | null): AuthenticatedUser | null {
  if (!ticket) return null;
  const entry = tickets.get(ticket);
  tickets.delete(ticket);
  if (!entry || entry.expiresAt <= Date.now()) return null;
  return entry.user;
}

export function invalidateWebSocketTicketsForUser(userId: string): void {
  for (const [ticket, entry] of tickets) {
    if (entry.user.id === userId) tickets.delete(ticket);
  }
}

export function clearExpiredWebSocketTickets(now = Date.now()): void {
  for (const [ticket, entry] of tickets) {
    if (entry.expiresAt <= now) tickets.delete(ticket);
  }
}
