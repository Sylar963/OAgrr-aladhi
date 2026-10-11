import type { ParadexTokenSettings } from '@oggregator/protocol';
import { getAddress, type Address, type Hex } from 'viem';
import { z } from 'zod';

export interface ParadexEnv {
  siweDomain: string;
  l1ChainId: number;
  apiV1: string;
  apiV2: string;
}

export const PARADEX_PROD: ParadexEnv = {
  siweDomain: 'app.paradex.trade',
  l1ChainId: 1,
  apiV1: 'https://api.prod.paradex.trade/v1',
  apiV2: 'https://api.prod.paradex.trade/v2',
};

const SIWE_AUTH_TTL_MS = 5 * 60 * 1000;

function isoSeconds(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 19)}Z`;
}

// Matches paradex-py EvmAccount._build_siwe_auth; Paradex verifies the exact bytes.
export function buildParadexSiweAuthMessage(input: {
  env: ParadexEnv;
  address: Address;
  nonce: string;
  nowMs: number;
}): string {
  const { siweDomain } = input.env;
  return [
    `${siweDomain} wants you to sign in with your Ethereum account:`,
    getAddress(input.address),
    '',
    'Paradex Auth',
    '',
    `URI: https://${siweDomain}`,
    'Version: 1',
    `Chain ID: ${input.env.l1ChainId}`,
    `Nonce: ${input.nonce}`,
    `Issued At: ${isoSeconds(input.nowMs)}`,
    `Expiration Time: ${isoSeconds(input.nowMs + SIWE_AUTH_TTL_MS)}`,
  ].join('\n');
}

function base64Utf8(text: string): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

const ParadexErrorSchema = z.object({ error: z.string().optional(), message: z.string().optional() });

async function paradexRequest<T>(
  url: string,
  init: RequestInit,
  schema: z.ZodType<T>,
): Promise<T> {
  const res = await fetch(url, init);
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const error = ParadexErrorSchema.safeParse(body);
    const detail = error.success ? (error.data.message ?? error.data.error) : undefined;
    throw new ParadexRequestError(res.status, detail ?? `HTTP ${res.status}`);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new Error(`Unexpected Paradex response from ${url}`);
  return parsed.data;
}

export class ParadexRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(`Paradex: ${message}`);
    this.name = 'ParadexRequestError';
  }
}

export type ParadexEvmAccount =
  | { kind: 'evm'; address: string }
  | { kind: 'not_onboarded' }
  | { kind: 'starknet_linked' };

const OnboardingSchema = z.object({ address: z.string(), exists: z.boolean() });

// Wallets onboarded before EVM sign-in own a Starknet-key account that this flow
// cannot sign for; Paradex reports that case as an error on the eip191 lookup.
export async function lookupParadexEvmAccount(
  env: ParadexEnv,
  ethAddress: Address,
): Promise<ParadexEvmAccount> {
  const query = new URLSearchParams({ account_signer_type: 'eip191', eth_address: ethAddress });
  try {
    const result = await paradexRequest(
      `${env.apiV1}/onboarding?${query}`,
      { method: 'GET' },
      OnboardingSchema,
    );
    return result.exists ? { kind: 'evm', address: result.address } : { kind: 'not_onboarded' };
  } catch (error) {
    if (error instanceof ParadexRequestError && /existing starknet account/i.test(error.message)) {
      return { kind: 'starknet_linked' };
    }
    throw error;
  }
}

export async function paradexEvmAuth(input: {
  env: ParadexEnv;
  paradexAccount: string;
  siweMessage: string;
  signature: Hex;
}): Promise<string> {
  const result = await paradexRequest(
    `${input.env.apiV2}/auth`,
    {
      method: 'POST',
      headers: {
        'PARADEX-STARKNET-ACCOUNT': input.paradexAccount,
        'PARADEX-EVM-SIGNATURE': input.signature,
        'PARADEX-SIWE-MESSAGE': base64Utf8(input.siweMessage),
      },
    },
    z.object({ jwt_token: z.string().min(1) }),
  );
  return result.jwt_token;
}

// token_type "JWT" is what app.paradex.trade sends when it creates a read-only key.
export async function createParadexReadonlyToken(input: {
  env: ParadexEnv;
  sessionJwt: string;
  settings: ParadexTokenSettings;
}): Promise<string> {
  const { settings } = input;
  const result = await paradexRequest(
    `${input.env.apiV1}/account/tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.sessionJwt}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: settings.name,
        token_type: 'JWT',
        expiry_duration: settings.expiryDurationSec,
        ...(settings.allowedCidrs.length > 0 && { allowed_cidrs: settings.allowedCidrs }),
      }),
    },
    z.object({ token: z.string().min(1) }),
  );
  return result.token;
}
