import { describe, expect, it } from 'vitest';
import { redactWsUrl } from './ws.js';

describe('redactWsUrl', () => {
  it('drops signed query params', () => {
    expect(redactWsUrl('wss://ws.coincall.com/options?code=10&apiKey=abc&sign=DEF')).toBe(
      'wss://ws.coincall.com/options?<redacted>',
    );
  });

  it('leaves plain URLs untouched', () => {
    expect(redactWsUrl('wss://www.deribit.com/ws/api/v2')).toBe('wss://www.deribit.com/ws/api/v2');
  });
});
