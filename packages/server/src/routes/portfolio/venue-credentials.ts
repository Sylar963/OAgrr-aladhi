import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { decodeParadexJwtClaims } from '@oggregator/core';
import {
  DeriveSessionKeyConfirmSchema,
  ParadexConnectSchema,
  type ParadexTokenSettings,
  type ThalexKeySlot,
  type ThalexKeySlots,
  VenueActivateSchema,
  type VenueEnvironment,
  VenueEnvironmentSchema,
  VenueIdSchema,
  type VenueId,
} from '@oggregator/protocol';
import { DEFAULT_ACCOUNT_ID } from '@oggregator/trading';

import { derivePositionStore } from '../../derive-position-store.js';
import { pendingDeriveSessionKeys } from '../../derive-session-keys.js';
import { paradexPositionStore } from '../../paradex-position-store.js';
import { thalexPositionStore } from '../../thalex-position-store.js';
import { getOrCreatePortfolioRuntime } from '../../portfolio-services.js';
import { venueCredentialsStore } from '../../trading-services.js';
import { getRequestAccountId } from '../../user-service.js';
import {
  getVenueCredentialCipher,
  venueCredentialContext,
  type VenueCredentialCipher,
} from '../../venue-credential-cipher.js';

const DeriveStoredCredentialsSchema = z.object({
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  sessionPrivateKey: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  publicSessionKey: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  subaccountId: z.number().int().positive(),
  expirySec: z.number().int().positive(),
});

const ParadexStoredCredentialsSchema = z.object({
  readonlyToken: z.string().min(1),
  account: z.string().min(1),
  expiresAtMs: z.number().int().positive(),
});

const ThalexCredentialsSchema = z.object({
  kid: z.string().min(1),
  privateKeyPem: z.string().min(1),
  account: z.string().optional(),
  env: z.enum(['prod', 'test']).optional(),
});

type DeriveStoredCredentials = z.infer<typeof DeriveStoredCredentialsSchema>;
type ParadexStoredCredentials = z.infer<typeof ParadexStoredCredentialsSchema>;
type ThalexCredentials = z.infer<typeof ThalexCredentialsSchema>;

const DEFAULT_PARADEX_TOKEN_TTL_DAYS = 90;
const MAX_PARADEX_TOKEN_TTL_DAYS = 365;

function paradexTokenSettings(): ParadexTokenSettings {
  const ttlDays = Number(process.env['PARADEX_READONLY_TOKEN_TTL_DAYS']);
  return {
    name: 'oggregator read-only',
    expiryDurationSec: Math.round(
      Math.min(
        Number.isFinite(ttlDays) && ttlDays > 0 ? ttlDays : DEFAULT_PARADEX_TOKEN_TTL_DAYS,
        MAX_PARADEX_TOKEN_TTL_DAYS,
      ) * 86_400,
    ),
    allowedCidrs: (process.env['PARADEX_READONLY_TOKEN_ALLOWED_CIDRS'] ?? '')
      .split(',')
      .map((cidr) => cidr.trim())
      .filter((cidr) => cidr.length > 0),
  };
}

function privateAdaptersEnabled(): boolean {
  const value = process.env['PRIVATE_VENUE_ADAPTERS_ENABLED'];
  return value === '1' || value === 'true';
}

function getAccountId(request: FastifyRequest): string {
  return getRequestAccountId(request, DEFAULT_ACCOUNT_ID);
}

function getCredentialStoreOrSendError(reply: FastifyReply): boolean {
  if (venueCredentialsStore.enabled) return true;
  reply.status(503).send({
    error: 'credential_storage_unavailable',
    message: 'Encrypted venue credential storage is not configured.',
  });
  return false;
}

function getCredentialCipherOrSendError(reply: FastifyReply): VenueCredentialCipher | null {
  if (!privateAdaptersEnabled()) {
    reply.status(403).send({
      error: 'private_adapters_disabled',
      message: 'Private venue connections are disabled on this deployment.',
    });
    return null;
  }
  if (!getCredentialStoreOrSendError(reply)) return null;
  const cipher = getVenueCredentialCipher();
  if (cipher == null) {
    reply.status(503).send({
      error: 'credential_encryption_unavailable',
      message: 'Venue credential encryption is not configured.',
    });
    return null;
  }
  return cipher;
}

async function connectDerive(
  accountId: string,
  credentials: DeriveStoredCredentials,
): Promise<void> {
  await derivePositionStore.connect({
    accountId,
    walletAddress: credentials.walletAddress,
    signerPrivateKey: credentials.sessionPrivateKey,
    subaccountId: credentials.subaccountId,
  });
  getOrCreatePortfolioRuntime(accountId, 'derive');
}

async function connectParadex(
  accountId: string,
  credentials: ParadexStoredCredentials,
): Promise<void> {
  await paradexPositionStore.connect({ accountId, readonlyToken: credentials.readonlyToken });
  getOrCreatePortfolioRuntime(accountId, 'paradex');
}

function isDeriveSessionKeyExpired(credentials: DeriveStoredCredentials): boolean {
  return credentials.expirySec * 1000 <= Date.now();
}

async function connectThalex(
  accountId: string,
  credentials: ThalexCredentials,
  environment: VenueEnvironment,
): Promise<void> {
  await thalexPositionStore.connect({
    accountId,
    kid: credentials.kid,
    privateKeyPem: credentials.privateKeyPem,
    ...(credentials.account != null && { account: credentials.account }),
    env: environment,
  });
  getOrCreatePortfolioRuntime(accountId, 'thalex');
}

const VENUE_ENVIRONMENTS: readonly VenueEnvironment[] = ['prod', 'test'];

function decryptThalexSlot(
  cipher: VenueCredentialCipher,
  accountId: string,
  environment: VenueEnvironment,
  encryptedCredentials: string,
): ThalexCredentials {
  const parsed = ThalexCredentialsSchema.safeParse(
    cipher.decrypt<unknown>(
      encryptedCredentials,
      venueCredentialContext(accountId, 'thalex', environment),
    ),
  );
  if (!parsed.success) throw new Error('Stored Thalex credentials are invalid');
  return parsed.data;
}

async function listThalexKeySlots(
  cipher: VenueCredentialCipher,
  accountId: string,
): Promise<ThalexKeySlots> {
  const stored = await venueCredentialsStore.listSlots(accountId, 'thalex');
  const connectedEnvironment = thalexPositionStore.environment(accountId);
  const slots = VENUE_ENVIRONMENTS.map((environment): ThalexKeySlot => {
    const slot = stored.find((row) => row.environment === environment);
    if (slot == null) {
      return { environment, configured: false, active: false, connected: false, kidHint: null, account: null };
    }
    let credentials: ThalexCredentials | null = null;
    try {
      credentials = decryptThalexSlot(cipher, accountId, environment, slot.encryptedCredentials);
    } catch {}
    return {
      environment,
      configured: true,
      active: slot.active,
      connected: slot.active && connectedEnvironment === environment,
      kidHint: credentials == null ? null : credentials.kid.slice(-4),
      account: credentials?.account ?? null,
    };
  });
  return { venue: 'thalex', slots };
}

export type ReconnectOutcome = 'connected' | 'not_connected' | 'removed';

async function reconnectStoredVenue(accountId: string, venue: VenueId): Promise<ReconnectOutcome> {
  const cipher = getVenueCredentialCipher();
  if (cipher == null) return 'not_connected';
  const stored = await venueCredentialsStore.get(accountId, venue);
  if (stored == null) {
    // Slots can exist with none active, e.g. after the active one was removed.
    const slots = await venueCredentialsStore.listSlots(accountId, venue);
    return slots.length > 0 ? 'not_connected' : 'removed';
  }

  if (venue === 'derive') {
    const parsed = DeriveStoredCredentialsSchema.safeParse(
      cipher.decrypt<unknown>(stored.encryptedCredentials, venueCredentialContext(accountId, venue)),
    );
    // Rows saved before wallet connect hold a user-pasted signing key; drop them so
    // the user reconnects through their wallet instead.
    if (!parsed.success) {
      await venueCredentialsStore.delete(accountId, venue);
      return 'removed';
    }
    if (isDeriveSessionKeyExpired(parsed.data)) return 'not_connected';
    await connectDerive(accountId, parsed.data);
    return 'connected';
  }
  if (venue === 'paradex') {
    const parsed = ParadexStoredCredentialsSchema.safeParse(
      cipher.decrypt<unknown>(stored.encryptedCredentials, venueCredentialContext(accountId, venue)),
    );
    if (!parsed.success) throw new Error('Stored Paradex credentials are invalid');
    if (parsed.data.expiresAtMs <= Date.now()) return 'not_connected';
    await connectParadex(accountId, parsed.data);
    return 'connected';
  }
  if (venue === 'thalex') {
    const credentials = decryptThalexSlot(
      cipher,
      accountId,
      stored.environment,
      stored.encryptedCredentials,
    );
    await connectThalex(accountId, credentials, stored.environment);
    return 'connected';
  }
  return 'not_connected';
}

/**
 * Reconnects a stored venue connection without a browser session, e.g. for a leaderboard
 * broadcast. Only mainnet: a testnet slot is never restored for anyone else to see.
 */
export async function restoreStoredVenue(
  accountId: string,
  venue: VenueId,
): Promise<ReconnectOutcome> {
  if (!privateAdaptersEnabled() || !venueCredentialsStore.enabled) return 'not_connected';
  const active = await venueCredentialsStore.get(accountId, venue);
  if (active != null && active.environment !== 'prod') return 'not_connected';
  return reconnectStoredVenue(accountId, venue);
}

async function disconnectVenue(accountId: string, venue: VenueId): Promise<void> {
  if (venue === 'derive') {
    await derivePositionStore.disconnect(accountId);
  } else if (venue === 'thalex') {
    await thalexPositionStore.disconnect(accountId);
  } else if (venue === 'paradex') {
    await paradexPositionStore.disconnect(accountId);
  }
}

export function isVenueConnected(accountId: string, venue: VenueId): boolean {
  if (venue === 'derive') return derivePositionStore.isConnected(accountId);
  if (venue === 'thalex') return thalexPositionStore.isConnected(accountId);
  if (venue === 'paradex') return paradexPositionStore.isConnected(accountId);
  return false;
}

/** True only for a mainnet session; anything shown to other users must use this. */
export function isMainnetVenueConnected(accountId: string, venue: VenueId): boolean {
  if (venue === 'thalex' && thalexPositionStore.environment(accountId) !== 'prod') return false;
  return isVenueConnected(accountId, venue);
}

async function restoreActiveSlot(accountId: string, request: FastifyRequest): Promise<void> {
  try {
    await reconnectStoredVenue(accountId, 'thalex');
  } catch (error) {
    request.log.warn({ accountId, err: String(error) }, 'thalex restore after failed connect failed');
  }
}

export async function portfolioVenueCredentialsRoute(app: FastifyInstance) {
  app.get('/portfolio/venue-credentials', async (request, reply) => {
    if (!getCredentialStoreOrSendError(reply)) return reply;
    const accountId = getAccountId(request);
    const venues = await venueCredentialsStore.listVenues(accountId);
    return {
      venues: venues.flatMap((rawVenue) => {
        const parsed = VenueIdSchema.safeParse(rawVenue);
        return parsed.success
          ? [
              {
                venue: parsed.data,
                configured: true,
                connected: isVenueConnected(accountId, parsed.data),
              },
            ]
          : [];
      }),
    };
  });

  app.post(
    '/portfolio/venue-credentials/reconnect',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      if (!privateAdaptersEnabled()) return { venues: [] };
      if (getCredentialCipherOrSendError(reply) == null) return reply;
      const accountId = getAccountId(request);
      const storedVenues = await venueCredentialsStore.listVenues(accountId);
      const results = await Promise.all(
        storedVenues.map(async (rawVenue) => {
          const parsed = VenueIdSchema.safeParse(rawVenue);
          if (!parsed.success) return null;
          try {
            const outcome = await reconnectStoredVenue(accountId, parsed.data);
            return {
              venue: parsed.data,
              configured: outcome !== 'removed',
              connected: outcome === 'connected',
            };
          } catch (error) {
            request.log.warn(
              { accountId, venue: parsed.data, err: String(error) },
              'stored venue reconnect failed',
            );
            return { venue: parsed.data, configured: true, connected: false };
          }
        }),
      );
      return { venues: results.filter((result) => result != null) };
    },
  );

  app.get('/portfolio/venue-credentials/paradex/token-settings', async (_request, reply) => {
    if (getCredentialCipherOrSendError(reply) == null) return reply;
    return paradexTokenSettings();
  });

  app.post(
    '/portfolio/venue-credentials/derive/session-key',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      if (getCredentialCipherOrSendError(reply) == null) return reply;
      return pendingDeriveSessionKeys.issue(getAccountId(request));
    },
  );

  app.post<{ Body: unknown }>(
    '/portfolio/venue-credentials/derive/session-key/confirm',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const cipher = getCredentialCipherOrSendError(reply);
      if (cipher == null) return reply;
      const body = DeriveSessionKeyConfirmSchema.safeParse(request.body);
      if (!body.success) {
        return reply.status(400).send({ error: 'invalid_request', issues: body.error.issues });
      }
      const accountId = getAccountId(request);
      const pending = pendingDeriveSessionKeys.get(accountId);
      if (pending == null) {
        return reply.status(409).send({
          error: 'session_key_not_pending',
          message: 'No Derive session key is waiting for confirmation. Start the wallet connect again.',
        });
      }
      const credentials: DeriveStoredCredentials = {
        walletAddress: body.data.walletAddress,
        sessionPrivateKey: pending.sessionKey.privateKey,
        publicSessionKey: pending.sessionKey.address,
        subaccountId: body.data.subaccountId,
        expirySec: pending.grant.expirySec,
      };
      try {
        await connectDerive(accountId, credentials);
        await venueCredentialsStore.upsert({
          accountId,
          venue: 'derive',
          encryptedCredentials: cipher.encrypt(
            credentials,
            venueCredentialContext(accountId, 'derive'),
          ),
        });
        pendingDeriveSessionKeys.consume(accountId);
        return { venue: 'derive' as const, connected: true, configured: true };
      } catch (error) {
        await disconnectVenue(accountId, 'derive').catch(() => {});
        request.log.warn({ accountId, err: String(error) }, 'derive session key confirm failed');
        return reply.status(502).send({
          error: 'connect_failed',
          message: 'Derive did not accept the session key. Check the wallet and subaccount.',
        });
      }
    },
  );

  app.post<{ Params: { venue: string }; Body: unknown }>(
    '/portfolio/venue-credentials/:venue',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const cipher = getCredentialCipherOrSendError(reply);
      if (cipher == null) return reply;
      const venueParsed = VenueIdSchema.safeParse(request.params.venue);
      if (!venueParsed.success) {
        return reply.status(400).send({ error: 'invalid_venue', issues: venueParsed.error.issues });
      }
      const venue = venueParsed.data;
      const accountId = getAccountId(request);

      try {
        if (venue === 'derive') {
          return reply.status(400).send({
            error: 'wallet_connect_required',
            message: 'Derive connects through your wallet, not a pasted key.',
          });
        }
        if (venue === 'paradex') {
          const { readonlyToken } = ParadexConnectSchema.parse(request.body);
          const claims = decodeParadexJwtClaims(readonlyToken);
          if (claims == null || claims.exp * 1000 <= Date.now()) {
            return reply.status(400).send({
              error: 'invalid_creds',
              message: 'The Paradex read-only key is malformed or expired.',
            });
          }
          const credentials: ParadexStoredCredentials = {
            readonlyToken,
            account: claims.sub,
            expiresAtMs: claims.exp * 1000,
          };
          await connectParadex(accountId, credentials);
          await venueCredentialsStore.upsert({
            accountId,
            venue,
            encryptedCredentials: cipher.encrypt(credentials, venueCredentialContext(accountId, venue)),
          });
          return { venue, connected: true, configured: true };
        }
        if (venue === 'thalex') {
          const credentials = ThalexCredentialsSchema.parse(request.body);
          const environment = credentials.env ?? 'prod';
          await connectThalex(accountId, credentials, environment);
          await venueCredentialsStore.upsert({
            accountId,
            venue,
            environment,
            encryptedCredentials: cipher.encrypt(
              { ...credentials, env: environment },
              venueCredentialContext(accountId, venue, environment),
            ),
          });
          return { venue, connected: true, configured: true };
        }
        return reply.status(501).send({
          error: 'not_implemented',
          message: `Private adapter for ${venue} is not available.`,
        });
      } catch (error) {
        await disconnectVenue(accountId, venue).catch(() => {});
        if (venue === 'thalex') await restoreActiveSlot(accountId, request);
        if (error instanceof z.ZodError) {
          return reply.status(400).send({ error: 'invalid_creds', issues: error.issues });
        }
        request.log.warn({ accountId, venue, err: String(error) }, 'venue connect failed');
        return reply
          .status(502)
          .send({ error: 'connect_failed', message: 'Venue connection failed' });
      }
    },
  );

  app.delete<{ Params: { venue: string }; Querystring: { environment?: string } }>(
    '/portfolio/venue-credentials/:venue',
    async (request, reply) => {
      if (!getCredentialStoreOrSendError(reply)) return reply;
      const venueParsed = VenueIdSchema.safeParse(request.params.venue);
      if (!venueParsed.success) {
        return reply.status(400).send({ error: 'invalid_venue' });
      }
      const venue = venueParsed.data;
      const environmentParsed = VenueEnvironmentSchema.optional().safeParse(
        request.query.environment,
      );
      if (!environmentParsed.success) {
        return reply.status(400).send({ error: 'invalid_environment' });
      }
      const environment = environmentParsed.data;
      const accountId = getAccountId(request);
      await venueCredentialsStore.delete(accountId, venue, environment);
      const sessionUsedRemovedKey =
        environment == null ||
        venue !== 'thalex' ||
        thalexPositionStore.environment(accountId) === environment;
      if (sessionUsedRemovedKey) {
        try {
          await disconnectVenue(accountId, venue);
        } catch (error) {
          request.log.warn(
            { accountId, venue, err: String(error) },
            'venue disconnect failed after credential deletion',
          );
        }
      }
      const remaining =
        environment == null ? [] : await venueCredentialsStore.listSlots(accountId, venue);
      return {
        venue,
        connected: isVenueConnected(accountId, venue),
        configured: remaining.length > 0,
      };
    },
  );

  app.get('/portfolio/venue-credentials/thalex/keys', async (request, reply) => {
    const cipher = getCredentialCipherOrSendError(reply);
    if (cipher == null) return reply;
    return listThalexKeySlots(cipher, getAccountId(request));
  });

  app.post<{ Body: unknown }>(
    '/portfolio/venue-credentials/thalex/activate',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const cipher = getCredentialCipherOrSendError(reply);
      if (cipher == null) return reply;
      const body = VenueActivateSchema.safeParse(request.body);
      if (!body.success) {
        return reply.status(400).send({ error: 'invalid_request', issues: body.error.issues });
      }
      const { environment } = body.data;
      const accountId = getAccountId(request);
      const slot = await venueCredentialsStore.get(accountId, 'thalex', environment);
      if (slot == null) {
        return reply.status(404).send({
          error: 'slot_not_configured',
          message: `No Thalex ${environment === 'prod' ? 'mainnet' : 'testnet'} key is saved.`,
        });
      }
      try {
        const credentials = decryptThalexSlot(
          cipher,
          accountId,
          environment,
          slot.encryptedCredentials,
        );
        await connectThalex(accountId, credentials, environment);
        await venueCredentialsStore.activate(accountId, 'thalex', environment);
      } catch (error) {
        request.log.warn({ accountId, environment, err: String(error) }, 'thalex switch failed');
        await disconnectVenue(accountId, 'thalex').catch(() => {});
        await restoreActiveSlot(accountId, request);
        return reply.status(502).send({
          error: 'connect_failed',
          message: 'Thalex did not accept that key. The previous connection was kept.',
        });
      }
      return listThalexKeySlots(cipher, accountId);
    },
  );

  app.get<{ Params: { venue: string } }>(
    '/portfolio/venue-credentials/:venue/status',
    async (request, reply) => {
      if (!getCredentialStoreOrSendError(reply)) return reply;
      const venueParsed = VenueIdSchema.safeParse(request.params.venue);
      if (!venueParsed.success) {
        return reply.status(400).send({ error: 'invalid_venue' });
      }
      const accountId = getAccountId(request);
      const slots = await venueCredentialsStore.listSlots(accountId, venueParsed.data);
      return {
        venue: venueParsed.data,
        configured: slots.length > 0,
        connected: isVenueConnected(accountId, venueParsed.data),
      };
    },
  );
}
