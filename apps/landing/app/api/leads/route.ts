import { NextResponse } from 'next/server';

import { leadSchema } from '@/lib/lead-schema';
import { persistLead } from '@/lib/lead-store';

export const runtime = 'nodejs';

const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 5;
// Cap tracked IPs so one-shot clients can't grow the map without bound; once over
// the cap we sweep expired entries before adding more.
const MAX_TRACKED_IPS = 10_000;
// Per-instance, in-memory. Good enough as a first abuse gate; not shared across instances.
const hits = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  if (hits.size > MAX_TRACKED_IPS) {
    for (const [key, value] of hits) {
      if (value.resetAt < now) hits.delete(key);
    }
  }
  const entry = hits.get(ip);
  if (!entry || now > entry.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_PER_WINDOW;
}

function isHoneypotHit(payload: unknown): boolean {
  if (typeof payload !== 'object' || payload === null) return false;
  const website = (payload as { website?: unknown }).website;
  return typeof website === 'string' && website.length > 0;
}

export async function POST(request: Request) {
  // Prefer the proxy-set client IP; x-real-ip is the single-IP header Vercel injects.
  // 'unknown' is a deliberate fail-closed shared bucket — a per-request unique key would
  // disable the limit entirely for header-less callers.
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip')?.trim() ??
    'unknown';

  if (isRateLimited(ip)) {
    return NextResponse.json({ ok: false, error: 'Too many requests.' }, { status: 429 });
  }

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON payload.' }, { status: 400 });
  }

  // Bots fill the hidden "website" field — pretend success, store nothing.
  if (isHoneypotHit(payload)) {
    return NextResponse.json({ ok: true }, { status: 201 });
  }

  const parsed = leadSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid payload.' }, { status: 400 });
  }

  try {
    await persistLead(parsed.data);
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Unable to record your request.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}
