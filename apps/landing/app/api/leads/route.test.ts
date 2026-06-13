import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach } from 'vitest';

import { POST } from './route';

let leadFilePath = '';

beforeEach(() => {
  leadFilePath = path.join(tmpdir(), `landing-leads-${randomUUID()}.jsonl`);
  process.env.LANDING_LEADS_FILE = leadFilePath;
});

afterEach(async () => {
  delete process.env.LANDING_LEADS_FILE;
  delete process.env.LANDING_API_BASE_URL;
  vi.unstubAllGlobals();
  await rm(leadFilePath, { force: true });
});

describe('POST /api/leads', () => {
  it('accepts a valid email payload', async () => {
    const request = new Request('http://localhost/api/leads', {
      method: 'POST',
      body: JSON.stringify({
        email: 'desk@example.com',
        source: 'landing-hero',
      }),
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.1' },
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(json.ok).toBe(true);

    const stored = await readFile(leadFilePath, 'utf8');
    const [line = ''] = stored.trim().split('\n');
    const record = JSON.parse(line) as {
      createdAt: string;
      email: string;
      source: string;
    };

    expect(record.email).toBe('desk@example.com');
    expect(record.source).toBe('landing-hero');
    expect(record.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('rejects an invalid email payload', async () => {
    const request = new Request('http://localhost/api/leads', {
      method: 'POST',
      body: JSON.stringify({
        email: 'bad-email',
        source: 'landing-hero',
      }),
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.2' },
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
  });

  it('forwards to the core API when LANDING_API_BASE_URL is set', async () => {
    process.env.LANDING_API_BASE_URL = 'https://api.example.test';
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 201 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const request = new Request('http://localhost/api/leads', {
      method: 'POST',
      body: JSON.stringify({ email: 'desk@example.com', source: 'landing-hero' }),
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.3' },
    });

    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/api/leads',
      expect.objectContaining({ method: 'POST' }),
    );
    // Forwarded successfully → no local fallback file written.
    await expect(readFile(leadFilePath, 'utf8')).rejects.toThrow();
  });

  it('falls back to the local file when the API call fails', async () => {
    process.env.LANDING_API_BASE_URL = 'https://api.example.test';
    const fetchMock = vi.fn(async () => new Response('nope', { status: 502 }));
    vi.stubGlobal('fetch', fetchMock);

    const request = new Request('http://localhost/api/leads', {
      method: 'POST',
      body: JSON.stringify({ email: 'desk@example.com', source: 'landing-hero' }),
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.4' },
    });

    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(fetchMock).toHaveBeenCalled();
    const stored = await readFile(leadFilePath, 'utf8');
    expect(stored).toContain('desk@example.com');
  });

  it('fakes success and stores nothing when the honeypot is filled', async () => {
    const request = new Request('http://localhost/api/leads', {
      method: 'POST',
      body: JSON.stringify({
        email: 'bot@example.com',
        source: 'landing-hero',
        website: 'http://spam.example',
      }),
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.5' },
    });

    const response = await POST(request);

    expect(response.status).toBe(201);
    await expect(readFile(leadFilePath, 'utf8')).rejects.toThrow();
  });

  it('rate limits a single IP after 5 requests in the window', async () => {
    const makeRequest = () =>
      new Request('http://localhost/api/leads', {
        method: 'POST',
        body: JSON.stringify({ email: 'desk@example.com', source: 'landing-hero' }),
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.6' },
      });

    for (let i = 0; i < 5; i += 1) {
      expect((await POST(makeRequest())).status).toBe(201);
    }
    expect((await POST(makeRequest())).status).toBe(429);
  });
});
