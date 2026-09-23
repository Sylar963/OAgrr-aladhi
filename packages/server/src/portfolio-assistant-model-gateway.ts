import type { PortfolioAssistantStreamErrorCode } from '@oggregator/protocol';

export interface PortfolioAssistantModelMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface StreamPortfolioAnswerRequest {
  threadId: string;
  systemInstructions: string;
  contextMessage: string;
  conversationMessages: PortfolioAssistantModelMessage[];
}

export type PortfolioAssistantModelEvent =
  | { type: 'text_delta'; delta: string }
  | {
      type: 'usage';
      inputTokens: number | null;
      cachedInputTokens: number | null;
      outputTokens: number | null;
    };

export interface PortfolioAssistantModelGateway {
  streamPortfolioAnswer(
    request: StreamPortfolioAnswerRequest,
    signal: AbortSignal,
  ): AsyncIterable<PortfolioAssistantModelEvent>;
  checkPortfolioAssistantModelAvailability(): Promise<'available' | 'unavailable'>;
}

export class PortfolioAssistantServiceError extends Error {
  constructor(
    readonly code:
      | PortfolioAssistantStreamErrorCode
      | 'persistence_unavailable'
      | 'context_changed'
      | 'invalid_body'
      | 'invalid_query',
    message: string,
    readonly statusCode: number,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'PortfolioAssistantServiceError';
  }
}
