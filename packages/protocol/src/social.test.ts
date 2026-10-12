import { describe, expect, it } from 'vitest';
import {
  ChatClientMessageSchema,
  SocialHandleSchema,
  UpdateSocialProfileRequestSchema,
} from './social.js';

describe('SocialHandleSchema', () => {
  it('accepts plain handles and rejects reserved or malformed ones', () => {
    expect(SocialHandleSchema.safeParse('theta_trader').success).toBe(true);
    expect(SocialHandleSchema.safeParse('ab').success).toBe(false);
    expect(SocialHandleSchema.safeParse('has space').success).toBe(false);
    expect(SocialHandleSchema.safeParse('Anon42').success).toBe(false);
    expect(SocialHandleSchema.safeParse('admin_x').success).toBe(false);
  });
});

describe('UpdateSocialProfileRequestSchema', () => {
  it('requires a handle to join the leaderboard', () => {
    expect(
      UpdateSocialProfileRequestSchema.safeParse({ handle: null, leaderboardVisible: true })
        .success,
    ).toBe(false);
    expect(
      UpdateSocialProfileRequestSchema.safeParse({ handle: null, leaderboardVisible: false })
        .success,
    ).toBe(true);
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
