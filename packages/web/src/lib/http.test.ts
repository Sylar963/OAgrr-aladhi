import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchJson } from './http';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function statusResponse(status: number, headers?: Record<string, string>): Response {
  return new Response(null, { status, headers });
}

describe('fetchJson retry behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('retries a transient 502 then resolves', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(statusResponse(502))
      .mockResolvedValueOnce(jsonResponse({ value: 1 }));
    vi.stubGlobal('fetch', fetchMock);

    const promise = fetchJson<{ value: number }>('/spot-candles');
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toEqual({ value: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a transient 504 then resolves', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(statusResponse(504))
      .mockResolvedValueOnce(jsonResponse({ value: 2 }));
    vi.stubGlobal('fetch', fetchMock);

    const promise = fetchJson<{ value: number }>('/spot-candles');
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toEqual({ value: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a transient 429 then resolves', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(statusResponse(429))
      .mockResolvedValueOnce(jsonResponse({ value: 3 }));
    vi.stubGlobal('fetch', fetchMock);

    const promise = fetchJson<{ value: number }>('/spot-candles');
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toEqual({ value: 3 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('honors a Retry-After header (longer than the default delay)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(statusResponse(429, { 'Retry-After': '2' }))
      .mockResolvedValueOnce(jsonResponse({ value: 4 }));
    vi.stubGlobal('fetch', fetchMock);

    const promise = fetchJson<{ value: number }>('/spot-candles');
    // The 1500ms default would have fired by now; Retry-After: 2s has not.
    await vi.advanceTimersByTimeAsync(1600);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(500); // cumulative 2100ms > 2000ms
    await expect(promise).resolves.toEqual({ value: 4 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('clamps an absurd Retry-After to the ceiling', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(statusResponse(429, { 'Retry-After': '999' }))
      .mockResolvedValueOnce(jsonResponse({ value: 5 }));
    vi.stubGlobal('fetch', fetchMock);

    const promise = fetchJson<{ value: number }>('/spot-candles');
    // Clamp is RETRY_DELAY_MS * 4 = 6000ms, not 999000ms.
    await vi.advanceTimersByTimeAsync(5999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(promise).resolves.toEqual({ value: 5 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects after exhausting the gateway retry budget on a persistent 502', async () => {
    const fetchMock = vi.fn().mockResolvedValue(statusResponse(502));
    vi.stubGlobal('fetch', fetchMock);

    const promise = fetchJson('/spot-candles');
    const assertion = expect(promise).rejects.toThrow(/API error: 502/);
    await vi.runAllTimersAsync();
    await assertion;
    // 1 initial + MAX_GATEWAY_RETRIES (3).
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('retries a 503 then resolves (readiness path unchanged)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(statusResponse(503))
      .mockResolvedValueOnce(jsonResponse({ value: 6 }));
    vi.stubGlobal('fetch', fetchMock);

    const promise = fetchJson<{ value: number }>('/ready');
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toEqual({ value: 6 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects with "Server still initializing" after the 503 budget', async () => {
    const fetchMock = vi.fn().mockResolvedValue(statusResponse(503));
    vi.stubGlobal('fetch', fetchMock);

    const promise = fetchJson('/ready');
    const assertion = expect(promise).rejects.toThrow('Server still initializing');
    await vi.runAllTimersAsync();
    await assertion;
    // 1 initial + MAX_RETRIES (10).
    expect(fetchMock).toHaveBeenCalledTimes(11);
  });

  it('retries a network error then resolves', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse({ value: 7 }));
    vi.stubGlobal('fetch', fetchMock);

    const promise = fetchJson<{ value: number }>('/spot-candles');
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toEqual({ value: 7 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fails fast on a 4xx without retrying', async () => {
    const fetchMock = vi.fn().mockResolvedValue(statusResponse(400));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchJson('/spot-candles')).rejects.toThrow(/API error: 400/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
