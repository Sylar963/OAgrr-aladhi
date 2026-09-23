import { describe, expect, it } from 'vitest';
import { PortfolioSourceSchema } from './portfolio.js';
import {
  PortfolioAssistantAccessSchema,
  PortfolioAssistantStreamEventSchema,
  SendPortfolioAssistantMessageRequestSchema,
} from './portfolio-assistant.js';

const UUID = '550e8400-e29b-41d4-a716-446655440000';

describe('portfolio assistant protocol', () => {
  it('accepts every source exposed by Portfolio', () => {
    for (const source of [
      'manual',
      'paper',
      'deribit',
      'okx',
      'binance',
      'bybit',
      'derive',
      'coincall',
      'thalex',
      'gateio',
      'paradex',
    ]) {
      expect(PortfolioSourceSchema.safeParse(source).success).toBe(true);
    }
  });

  it('enforces message and usage boundaries', () => {
    expect(
      SendPortfolioAssistantMessageRequestSchema.safeParse({
        clientMessageId: UUID,
        message: 'What is my largest risk?',
        forwardDays: 7,
      }).success,
    ).toBe(true);
    expect(
      SendPortfolioAssistantMessageRequestSchema.safeParse({
        clientMessageId: UUID,
        message: 'x'.repeat(4_001),
        forwardDays: 7,
      }).success,
    ).toBe(false);
    expect(
      PortfolioAssistantAccessSchema.safeParse({
        enabled: true,
        reason: 'entitled',
        expiresAt: null,
        dailyQuestionLimit: 20,
        dailyQuestionsUsed: -1,
      }).success,
    ).toBe(false);
  });

  it('validates stream event shapes', () => {
    const assistantMessageId = UUID;
    expect(
      PortfolioAssistantStreamEventSchema.safeParse({
        type: 'message_started',
        assistantMessageId,
        portfolioGeneratedAt: Date.now(),
      }).success,
    ).toBe(true);
    expect(
      PortfolioAssistantStreamEventSchema.safeParse({
        type: 'error',
        code: 'provider_timeout',
        message: 'Hermes timed out.',
        retryable: true,
      }).success,
    ).toBe(true);
    expect(
      PortfolioAssistantStreamEventSchema.safeParse({
        type: 'usage',
        inputTokens: -1,
        cachedInputTokens: null,
        outputTokens: 4,
      }).success,
    ).toBe(false);
  });
});
