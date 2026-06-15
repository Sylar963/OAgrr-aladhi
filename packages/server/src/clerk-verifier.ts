import { createRemoteJWKSet, type JWTPayload, jwtVerify } from 'jose';

export interface ClerkIdentity {
  clerkUserId: string;
  email: string | null;
  displayName: string | null;
}

type VerifyFn = (token: string) => Promise<{ payload: JWTPayload }>;

/** Pure mapping core — testable without network. Returns null on any failure. */
export async function verifyClerkTokenWith(
  token: string,
  verify: VerifyFn,
): Promise<ClerkIdentity | null> {
  if (!token) return null;
  let payload: JWTPayload;
  try {
    ({ payload } = await verify(token));
  } catch {
    return null;
  }
  const sub = typeof payload.sub === 'string' ? payload.sub : null;
  if (!sub) return null;
  const email = typeof payload['email'] === 'string' ? (payload['email'] as string) : null;
  const displayName = typeof payload['name'] === 'string' ? (payload['name'] as string) : null;
  return { clerkUserId: sub, email, displayName };
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks(): ReturnType<typeof createRemoteJWKSet> {
  if (jwks) return jwks;
  const jwksUrl = process.env['CLERK_JWKS_URL'];
  if (!jwksUrl) {
    throw new Error('CLERK_JWKS_URL is required to verify Clerk tokens');
  }
  jwks = createRemoteJWKSet(new URL(jwksUrl));
  return jwks;
}

/** Production verifier — caches the JWKS and verifies RS256 locally. */
export async function verifyClerkToken(token: string): Promise<ClerkIdentity | null> {
  return verifyClerkTokenWith(token, (t) => jwtVerify(t, getJwks()));
}
