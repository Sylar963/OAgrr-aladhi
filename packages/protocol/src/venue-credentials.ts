import { z } from 'zod';

import { VenueIdSchema, type VenueId } from './ws.js';

export const VenueCredentialFieldKeySchema = z.enum([
  'apiKey',
  'apiSecret',
  'passphrase',
  'clientId',
  'clientSecret',
  'subaccountId',
  'account',
  'walletAddress',
  'privateKeyPem',
  'kid',
  'readonlyToken',
]);
export type VenueCredentialFieldKey = z.infer<typeof VenueCredentialFieldKeySchema>;

export const VenueCredentialFieldSpecSchema = z.object({
  key: VenueCredentialFieldKeySchema,
  label: z.string(),
  placeholder: z.string().optional(),
  secret: z.boolean(),
  required: z.boolean(),
  multiline: z.boolean().optional(),
});
export type VenueCredentialFieldSpec = z.infer<typeof VenueCredentialFieldSpecSchema>;

export const VenuePrivateAdapterStatusSchema = z.enum(['planned', 'in_progress', 'available']);
export type VenuePrivateAdapterStatus = z.infer<typeof VenuePrivateAdapterStatusSchema>;

export const VenuePrivateAdapterSpecSchema = z.object({
  venue: VenueIdSchema,
  status: VenuePrivateAdapterStatusSchema,
  wsEndpoint: z.string(),
  authScheme: z.enum([
    'hmac',
    'jwt-rs512',
    'oauth-client-credentials',
    'eip191-session-key',
    'listen-key',
    'siwe-jwt',
  ]),
  connectMethod: z.enum(['credentials', 'wallet']),
  positionChannels: z.array(z.string()),
  subscribeMethod: z.string(),
  docsUrl: z.string(),
  credentialFields: z.array(VenueCredentialFieldSpecSchema),
  todos: z.array(z.string()),
});
export type VenuePrivateAdapterSpec = z.infer<typeof VenuePrivateAdapterSpecSchema>;

/** Venue network a key belongs to. Thalex mainnet and testnet keys are separate. */
export const VenueEnvironmentSchema = z.enum(['prod', 'test']);
export type VenueEnvironment = z.infer<typeof VenueEnvironmentSchema>;

/**
 * One stored Thalex key per environment. Keys saved through the portfolio are read-only;
 * trading keys are held by the execution daemon and never pass through the API.
 */
export const ThalexKeySlotSchema = z.object({
  environment: VenueEnvironmentSchema,
  configured: z.boolean(),
  /** The slot the portfolio connects to. At most one is active. */
  active: z.boolean(),
  connected: z.boolean(),
  /** Last characters of the key id, enough to tell keys apart. */
  kidHint: z.string().nullable(),
  account: z.string().nullable(),
});
export type ThalexKeySlot = z.infer<typeof ThalexKeySlotSchema>;

export const ThalexKeySlotsSchema = z.object({
  venue: z.literal('thalex'),
  slots: z.array(ThalexKeySlotSchema),
});
export type ThalexKeySlots = z.infer<typeof ThalexKeySlotsSchema>;

export const VenueActivateSchema = z.object({ environment: VenueEnvironmentSchema });
export type VenueActivate = z.infer<typeof VenueActivateSchema>;

export const DeriveSessionKeyGrantSchema = z.object({
  publicSessionKey: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  expirySec: z.number().int().positive(),
  ipWhitelist: z.array(z.string()),
  label: z.string(),
});
export type DeriveSessionKeyGrant = z.infer<typeof DeriveSessionKeyGrantSchema>;

export const DeriveSessionKeyConfirmSchema = z.object({
  walletAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, 'walletAddress must be a 0x-prefixed Ethereum address'),
  subaccountId: z.number().int().positive(),
});
export type DeriveSessionKeyConfirm = z.infer<typeof DeriveSessionKeyConfirmSchema>;

export const ParadexConnectSchema = z.object({
  readonlyToken: z.string().regex(/^[\w-]+\.[\w-]+\.[\w-]+$/, 'readonlyToken must be a JWT'),
});
export type ParadexConnect = z.infer<typeof ParadexConnectSchema>;

export const ParadexTokenSettingsSchema = z.object({
  expiryDurationSec: z.number().int().positive(),
  allowedCidrs: z.array(z.string()),
  name: z.string(),
});
export type ParadexTokenSettings = z.infer<typeof ParadexTokenSettingsSchema>;

export const VenueCredentialsSchema = z.object({
  venue: VenueIdSchema,
  label: z.string().optional(),
  fields: z.record(VenueCredentialFieldKeySchema, z.string()),
  addedAt: z.number().int().nonnegative(),
});
export type VenueCredentials = z.infer<typeof VenueCredentialsSchema>;

const COMMON_KEY: VenueCredentialFieldSpec = {
  key: 'apiKey',
  label: 'API key',
  placeholder: 'api_…',
  secret: false,
  required: true,
};

const COMMON_SECRET: VenueCredentialFieldSpec = {
  key: 'apiSecret',
  label: 'API secret',
  placeholder: '••••••••',
  secret: true,
  required: true,
};

export const PRIVATE_ADAPTER_SPECS: Readonly<Record<VenueId, VenuePrivateAdapterSpec>> = {
  deribit: {
    venue: 'deribit',
    status: 'planned',
    wsEndpoint: 'wss://www.deribit.com/ws/api/v2',
    authScheme: 'oauth-client-credentials',
    connectMethod: 'credentials',
    subscribeMethod: 'private/subscribe',
    positionChannels: ['user.portfolio.btc', 'user.portfolio.eth', 'user.changes.option.any.raw'],
    docsUrl: 'https://docs.deribit.com/#authentication',
    credentialFields: [
      {
        key: 'clientId',
        label: 'Client ID',
        placeholder: 'XXxxXXxx',
        secret: false,
        required: true,
      },
      {
        key: 'clientSecret',
        label: 'Client secret',
        placeholder: '••••••••',
        secret: true,
        required: true,
      },
    ],
    todos: [
      'create packages/core/src/feeds/deribit-private/ws-client.ts wrapping JsonRpcWsClient',
      'implement public/auth with grant_type=client_credentials → token cache + refresh',
      'subscribe to user.portfolio.{BTC,ETH} and user.changes.option.any.raw',
      'map portfolio payload → PositionLeg (deribit uses size as contracts)',
      'expose as PortfolioSource via portfolio-services.ts (extend PortfolioSource to "deribit")',
    ],
  },
  okx: {
    venue: 'okx',
    status: 'planned',
    wsEndpoint: 'wss://ws.okx.com:8443/ws/v5/private',
    authScheme: 'hmac',
    connectMethod: 'credentials',
    subscribeMethod: 'subscribe',
    positionChannels: ['positions'],
    docsUrl: 'https://www.okx.com/docs-v5/en/#overview-websocket-login',
    credentialFields: [
      COMMON_KEY,
      COMMON_SECRET,
      {
        key: 'passphrase',
        label: 'Passphrase',
        placeholder: 'set when creating the OKX API key',
        secret: true,
        required: true,
      },
    ],
    todos: [
      'create packages/core/src/feeds/okx-private/ws-client.ts using TopicWsClient',
      'login op: { args: [{ apiKey, passphrase, timestamp, sign }] } where sign = HMAC-SHA256(secret, ts + "GET" + "/users/self/verify")',
      'subscribe to channel "positions" filtered by instType=OPTION',
      'normalize OKX position fields (pos, avgPx) → PositionLeg',
      'add "okx" to PortfolioSource enum',
    ],
  },
  binance: {
    venue: 'binance',
    status: 'planned',
    wsEndpoint: 'wss://nbstream.binance.com/eoptions/ws/{listenKey}',
    authScheme: 'listen-key',
    connectMethod: 'credentials',
    subscribeMethod: 'POST /eapi/v1/userDataStream (REST) then connect WS to /eoptions/ws/{key}',
    positionChannels: ['ACCOUNT_UPDATE', 'EXECUTION_REPORT'],
    docsUrl: 'https://developers.binance.com/docs/derivatives/option/user-data-streams',
    credentialFields: [COMMON_KEY, COMMON_SECRET],
    todos: [
      'create packages/core/src/feeds/binance-private/listen-key-manager.ts (30-min keepalive PUT)',
      'create packages/core/src/feeds/binance-private/ws-client.ts',
      'POST /eapi/v1/userDataStream with X-MBX-APIKEY → listenKey',
      'open WS at /eoptions/ws/{listenKey}, no client-side subscribe needed',
      'GET /eapi/v1/position with HMAC-SHA256(secret, queryString) for initial snapshot',
      'add "binance" to PortfolioSource enum',
    ],
  },
  bybit: {
    venue: 'bybit',
    status: 'planned',
    wsEndpoint: 'wss://stream.bybit.com/v5/private',
    authScheme: 'hmac',
    connectMethod: 'credentials',
    subscribeMethod: 'subscribe',
    positionChannels: ['position'],
    docsUrl: 'https://bybit-exchange.github.io/docs/v5/ws/connect#authentication',
    credentialFields: [COMMON_KEY, COMMON_SECRET],
    todos: [
      'create packages/core/src/feeds/bybit-private/ws-client.ts using TopicWsClient',
      'auth op: { op: "auth", args: [apiKey, expires, sign] } where sign = HMAC-SHA256(secret, "GET/realtime" + expires)',
      'app-level ping required (existing bybit gotcha — { op: "ping" })',
      'subscribe to "position" with category=option',
      'normalize Bybit position fields → PositionLeg',
      'add "bybit" to PortfolioSource enum',
    ],
  },
  derive: {
    venue: 'derive',
    status: 'available',
    wsEndpoint: 'wss://api.derive.xyz/v3/ws',
    authScheme: 'eip191-session-key',
    connectMethod: 'wallet',
    subscribeMethod: 'subscribe',
    positionChannels: ['{subaccount_id}.balances'],
    docsUrl: 'https://docs.derive.xyz/authentication/session-keys',
    credentialFields: [],
    todos: [],
  },
  coincall: {
    venue: 'coincall',
    status: 'planned',
    wsEndpoint: 'wss://ws.coincall.com/options/private',
    authScheme: 'hmac',
    connectMethod: 'credentials',
    subscribeMethod: 'subscribe',
    positionChannels: ['position'],
    docsUrl: 'https://docs.coincall.com/#websocket-authentication',
    credentialFields: [COMMON_KEY, COMMON_SECRET],
    todos: [
      'create packages/core/src/feeds/coincall-private/ws-client.ts',
      'sign WS auth payload with HMAC-SHA256(secret, "GET" + path + ts)',
      'subscribe to "position" channel for options',
      'normalize Coincall position payload → PositionLeg',
      'add "coincall" to PortfolioSource enum',
    ],
  },
  thalex: {
    venue: 'thalex',
    status: 'available',
    wsEndpoint: 'wss://thalex.com/ws/api/v2',
    authScheme: 'jwt-rs512',
    connectMethod: 'credentials',
    subscribeMethod: 'private/subscribe',
    positionChannels: ['account.portfolio', 'account.summary'],
    docsUrl: 'https://thalex.com/docs/#tag/rpc_accounting',
    credentialFields: [
      {
        key: 'kid',
        label: 'Key ID (kid)',
        placeholder: 'from thalex dashboard',
        secret: false,
        required: true,
      },
      {
        key: 'privateKeyPem',
        label: 'RSA private key (PEM)',
        placeholder: '-----BEGIN RSA PRIVATE KEY-----\n…',
        secret: true,
        required: true,
        multiline: true,
      },
      {
        key: 'account',
        label: 'Account number',
        placeholder: 'optional: connect a non-default account',
        secret: false,
        required: false,
      },
    ],
    todos: [
      'add jsonwebtoken + @types/jsonwebtoken to packages/core/package.json',
      'create packages/core/src/feeds/thalex-private/auth.ts: mintAuthToken({ kid, privateKeyPem }) using RS512',
      'create packages/core/src/feeds/thalex-private/ws-client.ts wrapping JsonRpcWsClient with subscribeMethod="private/subscribe"',
      'public/login({ token, account? }) then private/subscribe(["account.portfolio","account.summary"])',
      'reuse instrument-name parser from feeds/thalex/codec.ts',
      'add "thalex" to PortfolioSource enum',
      'gate behind THALEX_PRIVATE_ENABLED env flag until ready',
    ],
  },
  gateio: {
    venue: 'gateio',
    status: 'planned',
    wsEndpoint: 'wss://op-ws.gateio.live/v4/ws/usdt',
    authScheme: 'hmac',
    connectMethod: 'credentials',
    subscribeMethod: 'subscribe',
    positionChannels: ['options.positions'],
    docsUrl: 'https://www.gate.com/docs/developers/options/ws/en/',
    credentialFields: [COMMON_KEY, COMMON_SECRET],
    todos: [
      'create packages/core/src/feeds/gateio-private/ws-client.ts using TopicWsClient',
      'sign auth op: { time, channel: "options.login", event: "api", payload: [{ api_key, timestamp, sign }] } where sign = HMAC-SHA256(secret, channel + "\\n" + event + "\\n" + timestamp)',
      'subscribe to options.positions channel after auth',
      'normalize Gate position fields (size, entry_price) → PositionLeg',
    ],
  },
  paradex: {
    venue: 'paradex',
    status: 'available',
    wsEndpoint: 'https://api.prod.paradex.trade/v1/positions',
    authScheme: 'siwe-jwt',
    connectMethod: 'wallet',
    subscribeMethod: 'poll',
    positionChannels: ['GET /positions'],
    docsUrl: 'https://docs.paradex.trade/api/general-information/api-authentication',
    credentialFields: [
      {
        key: 'readonlyToken',
        label: 'Read-only key',
        placeholder: 'Paradex → Settings → Key Management → Read-only',
        secret: true,
        required: true,
      },
    ],
    todos: [],
  },
};
