import { createRemoteJWKSet, type JWTPayload, type JWTVerifyOptions, jwtVerify } from 'jose';

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

function getJwtVerificationOptions(): JWTVerifyOptions {
  const jwksUrl = process.env['CLERK_JWKS_URL'];
  if (!jwksUrl) {
    throw new Error('CLERK_JWKS_URL is required to verify Clerk tokens');
  }
  const issuer = process.env['CLERK_JWT_ISSUER']?.trim() || new URL(jwksUrl).origin;
  const audience = process.env['CLERK_JWT_AUDIENCE']?.trim();
  return {
    algorithms: ['RS256'],
    issuer,
    ...(audience ? { audience } : {}),
  };
}

/** Production verifier — caches the JWKS and verifies issuer, expiry, and RS256 signature. */
export async function verifyClerkToken(token: string): Promise<ClerkIdentity | null> {
  return verifyClerkTokenWith(token, (value) =>
    jwtVerify(value, getJwks(), getJwtVerificationOptions()),
  );
}
