import { describe, expect, it } from 'vitest';
import { deriveParadexHealth } from './health.js';

describe('deriveParadexHealth', () => {
  it('connected when server time present and ws live', () => {
    expect(deriveParadexHealth({ serverTime: 1780930016216, wsConnected: true }).status).toBe('connected');
  });
  it('degraded when time probe fails', () => {
    expect(deriveParadexHealth({ serverTime: null, wsConnected: true }).status).toBe('degraded');
  });
  it('degraded when ws is down', () => {
    expect(deriveParadexHealth({ serverTime: 1780930016216, wsConnected: false }).status).toBe('degraded');
  });
});
