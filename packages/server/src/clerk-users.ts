import { z } from 'zod';

const CLERK_API_BASE = 'https://api.clerk.com/v1';
const LOOKUP_TIMEOUT_MS = 5_000;

const ClerkUserSchema = z.object({ username: z.string().nullable().optional() });

type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

/**
 * Reads the account username from the Clerk Backend API. `null` means the account has no
 * username; `undefined` means the lookup failed and the caller should keep what it has.
 */
export async function fetchClerkUsername(
  clerkUserId: string,
  secretKey: string | undefined = process.env['CLERK_SECRET_KEY'],
  fetchFn: FetchFn = fetch,
): Promise<string | null | undefined> {
  if (!secretKey) return undefined;
  try {
    const res = await fetchFn(`${CLERK_API_BASE}/users/${encodeURIComponent(clerkUserId)}`, {
      headers: { Authorization: `Bearer ${secretKey}` },
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
    if (!res.ok) return undefined;
    const parsed = ClerkUserSchema.safeParse(await res.json());
    if (!parsed.success) return undefined;
    const username = parsed.data.username?.trim();
    return username ? username : null;
  } catch {
    return undefined;
  }
}
