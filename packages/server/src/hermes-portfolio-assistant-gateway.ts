import { z } from 'zod';

import type { PortfolioAssistantConfiguration } from './portfolio-assistant-configuration.js';
import {
  type PortfolioAssistantModelEvent,
  type PortfolioAssistantModelGateway,
  PortfolioAssistantServiceError,
  type StreamPortfolioAnswerRequest,
} from './portfolio-assistant-model-gateway.js';

const CompletionChunkSchema = z
  .object({
    choices: z
      .array(
        z.object({
          delta: z.object({ content: z.string().optional() }).passthrough(),
        }),
      )
      .optional(),
    usage: z
      .object({
        prompt_tokens: z.number().int().nonnegative().optional(),
        completion_tokens: z.number().int().nonnegative().optional(),
        prompt_tokens_details: z
          .object({ cached_tokens: z.number().int().nonnegative().optional() })
          .optional(),
      })
      .optional(),
  })
  .passthrough();

async function* parseUpstreamEvents(
  stream: ReadableStream<Uint8Array>,
): AsyncIterable<PortfolioAssistantModelEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        const data = frame
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (!data || data === '[DONE]') continue;
        const parsedJson: unknown = JSON.parse(data);
        const parsed = CompletionChunkSchema.safeParse(parsedJson);
        if (!parsed.success) {
          throw new PortfolioAssistantServiceError(
            'invalid_provider_response',
            'Hermes returned an invalid stream.',
            502,
            true,
          );
        }
        const delta = parsed.data.choices?.[0]?.delta.content;
        if (delta) yield { type: 'text_delta', delta };
        if (parsed.data.usage) {
          yield {
            type: 'usage',
            inputTokens: parsed.data.usage.prompt_tokens ?? null,
            cachedInputTokens: parsed.data.usage.prompt_tokens_details?.cached_tokens ?? null,
            outputTokens: parsed.data.usage.completion_tokens ?? null,
          };
        }
      }
      if (done) break;
    }
    if (buffer.trim() && buffer.trim() !== 'data: [DONE]') {
      throw new PortfolioAssistantServiceError(
        'invalid_provider_response',
        'Hermes returned an incomplete stream.',
        502,
        true,
      );
    }
  } catch (error) {
    if (error instanceof PortfolioAssistantServiceError) throw error;
    if (error instanceof SyntaxError) {
      throw new PortfolioAssistantServiceError(
        'invalid_provider_response',
        'Hermes returned malformed data.',
        502,
        true,
      );
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export class HermesPortfolioAssistantGateway implements PortfolioAssistantModelGateway {
  constructor(
    private readonly configuration: PortfolioAssistantConfiguration,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  async checkPortfolioAssistantModelAvailability(): Promise<'available' | 'unavailable'> {
    if (!this.configuration.enabled || !this.configuration.apiKey) return 'unavailable';
    try {
      const response = await this.fetchImplementation(`${this.configuration.apiUrl}/models`, {
        headers: { Authorization: `Bearer ${this.configuration.apiKey}` },
        signal: AbortSignal.timeout(Math.min(this.configuration.requestTimeoutMs, 5_000)),
      });
      return response.ok ? 'available' : 'unavailable';
    } catch {
      return 'unavailable';
    }
  }

  async *streamPortfolioAnswer(
    request: StreamPortfolioAnswerRequest,
    signal: AbortSignal,
  ): AsyncIterable<PortfolioAssistantModelEvent> {
    if (!this.configuration.enabled || !this.configuration.apiKey) {
      throw new PortfolioAssistantServiceError(
        'provider_unavailable',
        'Portfolio assistant is temporarily unavailable.',
        503,
        true,
      );
    }
    const timeout = AbortSignal.timeout(this.configuration.requestTimeoutMs);
    const combined = AbortSignal.any([signal, timeout]);
    let response: Response;
    try {
      response = await this.fetchImplementation(`${this.configuration.apiUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.configuration.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.configuration.model,
          stream: true,
          stream_options: { include_usage: true },
          user: request.threadId,
          messages: [
            { role: 'system', content: request.systemInstructions },
            { role: 'user', content: request.contextMessage },
            ...request.conversationMessages,
          ],
        }),
        signal: combined,
      });
    } catch {
      if (signal.aborted)
        throw new PortfolioAssistantServiceError(
          'request_cancelled',
          'Request cancelled.',
          499,
          false,
        );
      if (timeout.aborted)
        throw new PortfolioAssistantServiceError(
          'provider_timeout',
          'Hermes did not respond in time.',
          504,
          true,
        );
      throw new PortfolioAssistantServiceError(
        'provider_unavailable',
        'Hermes is unreachable.',
        503,
        true,
      );
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const allowance = /quota|allowance|usage.limit|insufficient/i.test(body);
      if (allowance)
        throw new PortfolioAssistantServiceError(
          'provider_allowance_exhausted',
          'The shared model allowance is currently exhausted.',
          503,
          false,
        );
      throw new PortfolioAssistantServiceError(
        'provider_unavailable',
        'Hermes is temporarily unavailable.',
        503,
        response.status === 429 || response.status >= 500,
      );
    }
    if (!response.body)
      throw new PortfolioAssistantServiceError(
        'invalid_provider_response',
        'Hermes returned no response stream.',
        502,
        true,
      );
    try {
      yield* parseUpstreamEvents(response.body);
    } catch (error) {
      if (signal.aborted)
        throw new PortfolioAssistantServiceError(
          'request_cancelled',
          'Request cancelled.',
          499,
          false,
        );
      if (timeout.aborted)
        throw new PortfolioAssistantServiceError(
          'provider_timeout',
          'Hermes did not respond in time.',
          504,
          true,
        );
      throw error;
    }
  }
}

export { parseUpstreamEvents };
