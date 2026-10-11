import type { DeriveSessionKeyGrant } from '@oggregator/protocol';
import { encodeAbiParameters, getAddress, type Address, type Hex } from 'viem';
import { z } from 'zod';

export const DERIVE_WS_URL = 'wss://api.derive.xyz/v3/ws';

// Derive v3 action-signing constants (docs.derive.xyz/authentication/action-signing).
// verifyingContract is the v2 Matching address on every network, not a v3 contract.
const DERIVE_ACTION_DOMAIN = {
  name: 'Matching',
  version: '1.0',
  chainId: 1,
  verifyingContract: '0xeB8d770ec18DB98Db922E9D83260A585b9F0DeAD',
} as const;
const SET_SESSION_KEY_MODULE: Address = '0xe330CF64ff6EbF41699aad344Cb21d78db1D2bb6';
const SIGNATURE_TTL_SEC = 600;

const ACTION_TYPES = {
  Action: [
    { name: 'subaccountId', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'module', type: 'address' },
    { name: 'data', type: 'bytes' },
    { name: 'expiry', type: 'uint256' },
    { name: 'owner', type: 'address' },
    { name: 'signer', type: 'address' },
  ],
} as const;

export function deriveActionNonce(nowMs: number, suffix: number): string {
  return (BigInt(nowMs) * 1_000_000n + BigInt(suffix % 1_000_000)).toString();
}

export interface SetSessionKeyAction {
  typedData: {
    domain: typeof DERIVE_ACTION_DOMAIN;
    types: typeof ACTION_TYPES;
    primaryType: 'Action';
    message: {
      subaccountId: bigint;
      nonce: bigint;
      module: Address;
      data: Hex;
      expiry: bigint;
      owner: Address;
      signer: Address;
    };
  };
  nonce: string;
  signatureExpirySec: number;
}

// No protocol scopes: Derive treats a key without them as read-only, so the
// server-held key can log in and read positions but cannot trade or withdraw.
export function buildReadOnlySessionKeyAction(input: {
  owner: Address;
  grant: DeriveSessionKeyGrant;
  subaccountId: number;
  nowMs: number;
  nonceSuffix: number;
}): SetSessionKeyAction {
  const owner = getAddress(input.owner);
  const data = encodeAbiParameters(
    [{ type: 'address' }, { type: 'uint256' }, { type: 'uint256[]' }, { type: 'uint256[]' }],
    [
      getAddress(input.grant.publicSessionKey),
      BigInt(input.grant.expirySec),
      [],
      [BigInt(input.subaccountId)],
    ],
  );
  const nonce = deriveActionNonce(input.nowMs, input.nonceSuffix);
  const signatureExpirySec = Math.floor(input.nowMs / 1000) + SIGNATURE_TTL_SEC;
  return {
    typedData: {
      domain: DERIVE_ACTION_DOMAIN,
      types: ACTION_TYPES,
      primaryType: 'Action',
      message: {
        subaccountId: 0n,
        nonce: BigInt(nonce),
        module: SET_SESSION_KEY_MODULE,
        data,
        expiry: BigInt(signatureExpirySec),
        owner,
        signer: owner,
      },
    },
    nonce,
    signatureExpirySec,
  };
}

export function setSessionKeyParams(
  action: SetSessionKeyAction,
  grant: DeriveSessionKeyGrant,
  subaccountId: number,
  signature: Hex,
): Record<string, unknown> {
  const { owner } = action.typedData.message;
  return {
    wallet: owner,
    public_session_key: getAddress(grant.publicSessionKey),
    expiry_sec: grant.expirySec,
    subaccount_ids: [subaccountId],
    protocol_scopes: [],
    offchain_scopes: ['account_info'],
    label: grant.label,
    ip_whitelist: grant.ipWhitelist,
    nonce: action.nonce,
    signer: owner,
    signature,
    signature_expiry_sec: action.signatureExpirySec,
    module: SET_SESSION_KEY_MODULE,
  };
}

const RpcResponseSchema = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  result: z.unknown().optional(),
  error: z.object({ code: z.number(), message: z.string() }).optional(),
});

export const DeriveLoginResultSchema = z.array(z.number().int().nonnegative());

export class DeriveRpcSocket {
  private nextId = 1;
  private readonly inflight = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();

  private constructor(private readonly ws: WebSocket) {
    ws.addEventListener('message', (event) => {
      const parsed = RpcResponseSchema.safeParse(JSON.parse(String(event.data)));
      if (!parsed.success || typeof parsed.data.id !== 'number') return;
      const pending = this.inflight.get(parsed.data.id);
      if (pending == null) return;
      this.inflight.delete(parsed.data.id);
      if (parsed.data.error != null) {
        pending.reject(new Error(`Derive: ${parsed.data.error.message}`));
      } else {
        pending.resolve(parsed.data.result);
      }
    });
    ws.addEventListener('close', () => {
      for (const pending of this.inflight.values()) {
        pending.reject(new Error('Derive connection closed'));
      }
      this.inflight.clear();
    });
  }

  static open(url: string = DERIVE_WS_URL): Promise<DeriveRpcSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.addEventListener('open', () => resolve(new DeriveRpcSocket(ws)), { once: true });
      ws.addEventListener('error', () => reject(new Error('Could not reach Derive')), {
        once: true,
      });
    });
  }

  call(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.inflight.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }

  close(): void {
    this.ws.close();
  }
}
