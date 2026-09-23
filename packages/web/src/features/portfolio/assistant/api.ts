import { getClerkToken } from '@lib/clerk-token';
import {
  type CreatePortfolioAssistantThreadRequest,
  type PortfolioAssistantAccess,
  PortfolioAssistantAccessSchema,
  type PortfolioAssistantErrorResponse,
  type PortfolioAssistantMessagePage,
  PortfolioAssistantMessagePageSchema,
  type PortfolioAssistantStreamEvent,
  type PortfolioAssistantThread,
  type PortfolioAssistantThreadList,
  PortfolioAssistantThreadListSchema,
  PortfolioAssistantThreadSchema,
  type SendPortfolioAssistantMessageRequest,
} from '@oggregator/protocol';

import { parsePortfolioAssistantEventStream } from './stream';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api';

interface RuntimeSchema<T> {
  safeParse(
    input: unknown,
  ): { success: true; data: T } | { success: false; error: { message: string } };
}

export class PortfolioAssistantApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly status: number,
  ) {
    super(message);
    this.name = 'PortfolioAssistantApiError';
  }
}

async function headers(): Promise<HeadersInit> {
  const token = await getClerkToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function parseJson<T>(response: Response, schema: RuntimeSchema<T>): Promise<T> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (body ?? {}) as Partial<PortfolioAssistantErrorResponse>;
    throw new PortfolioAssistantApiError(
      error.error ?? 'request_failed',
      error.message ?? `Portfolio Assistant request failed (${response.status}).`,
      error.retryable ?? response.status >= 500,
      response.status,
    );
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success)
    throw new PortfolioAssistantApiError('invalid_response', parsed.error.message, true, 502);
  return parsed.data;
}

export async function fetchPortfolioAssistantAccess(): Promise<PortfolioAssistantAccess> {
  const response = await fetch(`${API_BASE}/portfolio/assistant/access`, {
    headers: await headers(),
  });
  return parseJson(response, PortfolioAssistantAccessSchema);
}

export async function redeemPortfolioAssistantInvite(
  code: string,
): Promise<PortfolioAssistantAccess> {
  const response = await fetch(`${API_BASE}/portfolio/assistant/invites/redeem`, {
    method: 'POST',
    headers: await headers(),
    body: JSON.stringify({ code }),
  });
  return parseJson(response, PortfolioAssistantAccessSchema);
}

export async function createPortfolioAssistantThread(
  input: CreatePortfolioAssistantThreadRequest,
): Promise<PortfolioAssistantThread> {
  const response = await fetch(`${API_BASE}/portfolio/assistant/threads`, {
    method: 'POST',
    headers: await headers(),
    body: JSON.stringify(input),
  });
  return parseJson(response, PortfolioAssistantThreadSchema);
}

export async function fetchPortfolioAssistantThreads(
  source: string,
  underlying: string | null,
): Promise<PortfolioAssistantThreadList> {
  const params = new URLSearchParams({ source });
  if (underlying) params.set('underlying', underlying);
  const response = await fetch(`${API_BASE}/portfolio/assistant/threads?${params}`, {
    headers: await headers(),
  });
  return parseJson(response, PortfolioAssistantThreadListSchema);
}

export async function fetchPortfolioAssistantMessages(
  threadId: string,
  cursor?: string,
): Promise<PortfolioAssistantMessagePage> {
  const suffix = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  const response = await fetch(
    `${API_BASE}/portfolio/assistant/threads/${encodeURIComponent(threadId)}/messages${suffix}`,
    { headers: await headers() },
  );
  return parseJson(response, PortfolioAssistantMessagePageSchema);
}

export async function deletePortfolioAssistantThread(threadId: string): Promise<void> {
  const response = await fetch(
    `${API_BASE}/portfolio/assistant/threads/${encodeURIComponent(threadId)}`,
    {
      method: 'DELETE',
      headers: await headers(),
    },
  );
  if (!response.ok && response.status !== 404) {
    const body = (await response
      .json()
      .catch(() => null)) as Partial<PortfolioAssistantErrorResponse> | null;
    throw new PortfolioAssistantApiError(
      body?.error ?? 'delete_failed',
      body?.message ?? 'Could not delete conversation.',
      body?.retryable ?? true,
      response.status,
    );
  }
}

export async function streamPortfolioAssistantMessage(
  threadId: string,
  input: SendPortfolioAssistantMessageRequest,
  signal: AbortSignal,
  onEvent: (event: PortfolioAssistantStreamEvent) => void,
): Promise<void> {
  const response = await fetch(
    `${API_BASE}/portfolio/assistant/threads/${encodeURIComponent(threadId)}/messages`,
    {
      method: 'POST',
      headers: await headers(),
      body: JSON.stringify(input),
      signal,
    },
  );
  if (!response.ok) {
    const body = (await response
      .json()
      .catch(() => null)) as Partial<PortfolioAssistantErrorResponse> | null;
    throw new PortfolioAssistantApiError(
      body?.error ?? 'request_failed',
      body?.message ?? 'Could not ask Hermes.',
      body?.retryable ?? response.status >= 500,
      response.status,
    );
  }
  if (!response.body)
    throw new PortfolioAssistantApiError(
      'invalid_response',
      'The assistant response stream was empty.',
      true,
      502,
    );
  for await (const event of parsePortfolioAssistantEventStream(response.body)) onEvent(event);
}
