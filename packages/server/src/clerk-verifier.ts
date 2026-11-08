import { createRemoteJWKSet, errors, type JWTPayload, type JWTVerifyOptions, jwtVerify } from 'jose';
import { logger } from '@oggregator/core';
import { allowedOrigins } from './security-configuration.js';

/** Minutes since each factor was last verified (Clerk `fva`); null = never or no such factor. */
export interface FactorAgeMinutes {
  first: number | null;
  second: number | null;
}

export interface ClerkIdentity {
  clerkUserId: string;
  email: string | null;
  displayName: string | null;
  factorAgeMinutes: FactorAgeMinutes;
}

type VerifyFn = (token: string) => Promise<{ payload: JWTPayload }>;
type FailureReason = 'expired' | 'invalid_signature' | 'jwks_timeout' | 'invalid_token' | 'missing_subject' | 'unauthorized_origin';

function failureReason(error: unknown): FailureReason {
  if (error instanceof errors.JWTExpired) return 'expired';
  if (error instanceof errors.JWSSignatureVerificationFailed) return 'invalid_signature';
  if (error instanceof errors.JWKSTimeout) return 'jwks_timeout';
  return 'invalid_token';
}

function factorAge(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export function parseFactorVerificationAge(fva: unknown): FactorAgeMinutes {
  if (!Array.isArray(fva)) return { first: null, second: null };
  return { first: factorAge(fva[0]), second: factorAge(fva[1]) };
}

/** Pure mapping core — testable without network. Returns null on any failure. */
export async function verifyClerkTokenWith(
  token: string,
  verify: VerifyFn,
  authorizedParties: readonly string[] | null = null,
  onFailure: (reason: FailureReason) => void = () => {},
): Promise<ClerkIdentity | null> {
  if (!token) return null;
  let payload: JWTPayload;
  try {
    ({ payload } = await verify(token));
  } catch (error: unknown) {
    onFailure(failureReason(error));
    return null;
  }
  const sub = typeof payload.sub === 'string' ? payload.sub : null;
  if (!sub) {
    onFailure('missing_subject');
    return null;
  }
  // Clerk sets `azp` to the browser origin that requested the token.
  const azp = payload['azp'];
  if (azp !== undefined && authorizedParties !== null) {
    if (typeof azp !== 'string' || !authorizedParties.includes(azp)) {
      onFailure('unauthorized_origin');
      return null;
    }
  }
  const email = typeof payload['email'] === 'string' ? (payload['email'] as string) : null;
  const displayName = typeof payload['name'] === 'string' ? (payload['name'] as string) : null;
  return {
    clerkUserId: sub,
    email,
    displayName,
    factorAgeMinutes: parseFactorVerificationAge(payload['fva']),
  };
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
const lastFailureLog = new Map<FailureReason, number>();

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
  return verifyClerkTokenWith(
    token,
    (value) => jwtVerify(value, getJwks(), getJwtVerificationOptions()),
    allowedOrigins(process.env),
    (reason) => {
      const now = Date.now();
      if (now - (lastFailureLog.get(reason) ?? 0) < 30_000) return;
      lastFailureLog.set(reason, now);
      logger.warn({ component: 'account-auth', reason }, 'Clerk token rejected');
    },
  );
}
