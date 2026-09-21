import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { VenueIdSchema, type VenueId } from '@oggregator/protocol';
import { DEFAULT_ACCOUNT_ID } from '@oggregator/trading';

import { derivePositionStore } from '../../derive-position-store.js';
import { thalexPositionStore } from '../../thalex-position-store.js';
import { getOrCreatePortfolioRuntime } from '../../portfolio-services.js';
import { venueCredentialsStore } from '../../trading-services.js';
import { getRequestAccountId } from '../../user-service.js';
import {
  getVenueCredentialCipher,
  type VenueCredentialCipher,
} from '../../venue-credential-cipher.js';

const DeriveCredentialsSchema = z.object({
  walletAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, 'walletAddress must be a 0x-prefixed Ethereum address'),
  signerPrivateKey: z
    .string()
    .regex(/^(0x)?[a-fA-F0-9]{64}$/, 'signerPrivateKey must be 32-byte hex'),
  subaccountId: z.coerce.number().int().positive(),
  env: z.enum(['prod', 'test']).optional(),
});

const ThalexCredentialsSchema = z.object({
  kid: z.string().min(1),
  privateKeyPem: z.string().min(1),
  account: z.string().optional(),
  env: z.enum(['prod', 'test']).optional(),
});

type DeriveCredentials = z.infer<typeof DeriveCredentialsSchema>;
type ThalexCredentials = z.infer<typeof ThalexCredentialsSchema>;

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

async function connectDerive(accountId: string, credentials: DeriveCredentials): Promise<void> {
  await derivePositionStore.connect({
    accountId,
    walletAddress: credentials.walletAddress,
    signerPrivateKey: credentials.signerPrivateKey,
    subaccountId: credentials.subaccountId,
    ...(credentials.env != null && { env: credentials.env }),
  });
  getOrCreatePortfolioRuntime(accountId, 'derive');
}

async function connectThalex(accountId: string, credentials: ThalexCredentials): Promise<void> {
  await thalexPositionStore.connect({
    accountId,
    kid: credentials.kid,
    privateKeyPem: credentials.privateKeyPem,
    ...(credentials.account != null && { account: credentials.account }),
    ...(credentials.env != null && { env: credentials.env }),
  });
  getOrCreatePortfolioRuntime(accountId, 'thalex');
}

async function reconnectStoredVenue(accountId: string, venue: VenueId): Promise<boolean> {
  const cipher = getVenueCredentialCipher();
  if (cipher == null) return false;
  const stored = await venueCredentialsStore.get(accountId, venue);
  if (stored == null) return false;

  if (venue === 'derive') {
    const parsed = DeriveCredentialsSchema.safeParse(
      cipher.decrypt<unknown>(stored.encryptedCredentials),
    );
    if (!parsed.success) throw new Error('Stored Derive credentials are invalid');
    await connectDerive(accountId, parsed.data);
    return true;
  }
  if (venue === 'thalex') {
    const parsed = ThalexCredentialsSchema.safeParse(
      cipher.decrypt<unknown>(stored.encryptedCredentials),
    );
    if (!parsed.success) throw new Error('Stored Thalex credentials are invalid');
    await connectThalex(accountId, parsed.data);
    return true;
  }
  return false;
}

async function disconnectVenue(accountId: string, venue: VenueId): Promise<void> {
  if (venue === 'derive') {
    await derivePositionStore.disconnect(accountId);
  } else if (venue === 'thalex') {
    await thalexPositionStore.disconnect(accountId);
  }
}

function isVenueConnected(accountId: string, venue: VenueId): boolean {
  if (venue === 'derive') return derivePositionStore.isConnected(accountId);
  if (venue === 'thalex') return thalexPositionStore.isConnected(accountId);
  return false;
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

  app.post('/portfolio/venue-credentials/reconnect', async (request, reply) => {
    if (!privateAdaptersEnabled()) return { venues: [] };
    if (getCredentialCipherOrSendError(reply) == null) return reply;
    const accountId = getAccountId(request);
    const storedVenues = await venueCredentialsStore.listVenues(accountId);
    const results = await Promise.all(
      storedVenues.map(async (rawVenue) => {
        const parsed = VenueIdSchema.safeParse(rawVenue);
        if (!parsed.success) return null;
        try {
          const connected = await reconnectStoredVenue(accountId, parsed.data);
          return { venue: parsed.data, configured: true, connected };
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
  });

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
          const credentials = DeriveCredentialsSchema.parse(request.body);
          await connectDerive(accountId, credentials);
          await venueCredentialsStore.upsert({
            accountId,
            venue,
            encryptedCredentials: cipher.encrypt(credentials),
          });
          return { venue, connected: true, configured: true };
        }
        if (venue === 'thalex') {
          const credentials = ThalexCredentialsSchema.parse(request.body);
          await connectThalex(accountId, credentials);
          await venueCredentialsStore.upsert({
            accountId,
            venue,
            encryptedCredentials: cipher.encrypt(credentials),
          });
          return { venue, connected: true, configured: true };
        }
        return reply.status(501).send({
          error: 'not_implemented',
          message: `Private adapter for ${venue} is not available.`,
        });
      } catch (error) {
        await disconnectVenue(accountId, venue).catch(() => {});
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

  app.delete<{ Params: { venue: string } }>(
    '/portfolio/venue-credentials/:venue',
    async (request, reply) => {
      if (!getCredentialStoreOrSendError(reply)) return reply;
      const venueParsed = VenueIdSchema.safeParse(request.params.venue);
      if (!venueParsed.success) {
        return reply.status(400).send({ error: 'invalid_venue' });
      }
      const accountId = getAccountId(request);
      await venueCredentialsStore.delete(accountId, venueParsed.data);
      try {
        await disconnectVenue(accountId, venueParsed.data);
      } catch (error) {
        request.log.warn(
          { accountId, venue: venueParsed.data, err: String(error) },
          'venue disconnect failed after credential deletion',
        );
      }
      return { venue: venueParsed.data, connected: false, configured: false };
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
      const configured = await venueCredentialsStore.get(accountId, venueParsed.data);
      return {
        venue: venueParsed.data,
        configured: configured != null,
        connected: isVenueConnected(accountId, venueParsed.data),
      };
    },
  );
}
