import { describe, expect, it } from 'vitest';
import { ChatClientMessageSchema, UpdateSocialProfileRequestSchema } from './social.js';

describe('UpdateSocialProfileRequestSchema', () => {
  it('only accepts the leaderboard opt-in, never a handle', () => {
    expect(UpdateSocialProfileRequestSchema.safeParse({ leaderboardVisible: true }).success).toBe(
      true,
    );
    expect(
      UpdateSocialProfileRequestSchema.safeParse({ leaderboardVisible: true, handle: 'spoof' })
        .success,
    ).toBe(false);
  });

  it('accepts a broadcast venue only from the supported venues', () => {
    expect(
      UpdateSocialProfileRequestSchema.safeParse({
        leaderboardVisible: true,
        broadcastVenue: 'derive',
      }).success,
    ).toBe(true);
    expect(
      UpdateSocialProfileRequestSchema.safeParse({
        leaderboardVisible: true,
        broadcastVenue: 'paper',
      }).success,
    ).toBe(false);
  });
});

describe('ChatClientMessageSchema', () => {
  it('trims and bounds message bodies', () => {
    expect(
      ChatClientMessageSchema.safeParse({ type: 'send', body: '   ', anon: false }).success,
    ).toBe(false);
    expect(
      ChatClientMessageSchema.safeParse({ type: 'send', body: 'x'.repeat(501), anon: true })
        .success,
    ).toBe(false);
    const parsed = ChatClientMessageSchema.parse({ type: 'send', body: ' gm ', anon: true });
    expect(parsed).toEqual({ type: 'send', body: 'gm', anon: true });
  });
});
