import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const base = {
  TASTYTRADE_CLIENT_ID: 'cid',
  TASTYTRADE_CLIENT_SECRET: 'secret',
  TASTYTRADE_REFRESH_TOKEN: 'refresh',
};

describe('loadConfig', () => {
  it('applies defaults', () => {
    const cfg = loadConfig(base);
    expect(cfg.port).toBe(3200);
    expect(cfg.baseUrl).toBe('https://api.tastyworks.com');
    expect(cfg.underlyings).toEqual(['SPX', 'NDX', 'SPY', 'QQQ', 'AAPL', 'NVDA', 'TSLA']);
  });

  it('parses TRADFI_UNDERLYINGS and TRADFI_PORT', () => {
    const cfg = loadConfig({ ...base, TRADFI_UNDERLYINGS: 'AAPL, SPY ,QQQ', TRADFI_PORT: '4000' });
    expect(cfg.underlyings).toEqual(['AAPL', 'SPY', 'QQQ']);
    expect(cfg.port).toBe(4000);
  });

  it('throws when a required secret is missing', () => {
    expect(() => loadConfig({})).toThrow(/TASTYTRADE_CLIENT_ID/);
  });
});
