import { describe, expect, it } from 'vitest';
import {
  decodeAbiParameters,
  encodeAbiParameters,
  hashDomain,
  hashTypedData,
  keccak256,
  toHex,
} from 'viem';

import {
  buildReadOnlySessionKeyAction,
  deriveActionNonce,
  setSessionKeyParams,
} from './derive-session-key';

// Published in docs.derive.xyz/authentication/action-signing.
const MAINNET_DOMAIN_SEPARATOR = '0xda616dfabb88681b08e1592820a41d55ddc62d68de110e327ae99d734506fe19';
const ACTION_TYPEHASH = '0x4d7a9f27c403ff9c0f19bce61d76d82f9aa29f8d6d4b0c5474607d9770d1af17';

const OWNER = '0x1234567890AbcdEF1234567890aBcdef12345678';
const grant = {
  publicSessionKey: '0x9f00000000000000000000000000000000000001',
  expirySec: 1_800_000_000,
  ipWhitelist: ['203.0.113.7'],
  label: 'oggregator read-only',
};

function build() {
  return buildReadOnlySessionKeyAction({
    owner: OWNER,
    grant,
    subaccountId: 42,
    nowMs: 1_790_000_000_000,
    nonceSuffix: 123,
  });
}

describe('buildReadOnlySessionKeyAction', () => {
  it('uses the documented Derive mainnet domain', () => {
    const { typedData } = build();
    expect(
      hashDomain({
        domain: { ...typedData.domain, chainId: BigInt(typedData.domain.chainId) },
        types: {
          EIP712Domain: [
            { name: 'name', type: 'string' },
            { name: 'version', type: 'string' },
            { name: 'chainId', type: 'uint256' },
            { name: 'verifyingContract', type: 'address' },
          ],
        },
      }),
    ).toBe(MAINNET_DOMAIN_SEPARATOR);
  });

  it('produces the digest Derive rebuilds from the Action struct', () => {
    const { typedData } = build();
    const m = typedData.message;
    const actionHash = keccak256(
      encodeAbiParameters(
        [
          { type: 'bytes32' },
          { type: 'uint256' },
          { type: 'uint256' },
          { type: 'address' },
          { type: 'bytes32' },
          { type: 'uint256' },
          { type: 'address' },
          { type: 'address' },
        ],
        [ACTION_TYPEHASH, m.subaccountId, m.nonce, m.module, keccak256(m.data), m.expiry, m.owner, m.signer],
      ),
    );
    const digest = keccak256(`0x1901${MAINNET_DOMAIN_SEPARATOR.slice(2)}${actionHash.slice(2)}`);
    expect(hashTypedData(typedData)).toBe(digest);
    expect(keccak256(toHex(
      'Action(uint256 subaccountId,uint256 nonce,address module,bytes data,uint256 expiry,address owner,address signer)',
    ))).toBe(ACTION_TYPEHASH);
  });

  it('grants no protocol scopes and only the chosen subaccount', () => {
    const { typedData } = build();
    const [sessionKey, expirySec, scopes, subaccounts] = decodeAbiParameters(
      [{ type: 'address' }, { type: 'uint256' }, { type: 'uint256[]' }, { type: 'uint256[]' }],
      typedData.message.data,
    );
    expect(sessionKey.toLowerCase()).toBe(grant.publicSessionKey);
    expect(expirySec).toBe(BigInt(grant.expirySec));
    expect(scopes).toEqual([]);
    expect(subaccounts).toEqual([42n]);
    expect(typedData.message.subaccountId).toBe(0n);
    expect(typedData.message.signer).toBe(typedData.message.owner);
  });

  it('sends wire params that match what was signed', () => {
    const action = build();
    const params = setSessionKeyParams(action, grant, 42, '0xabc');
    expect(params).toMatchObject({
      wallet: OWNER,
      signer: OWNER,
      nonce: action.typedData.message.nonce.toString(),
      signature_expiry_sec: Number(action.typedData.message.expiry),
      expiry_sec: grant.expirySec,
      subaccount_ids: [42],
      protocol_scopes: [],
      offchain_scopes: ['account_info'],
      ip_whitelist: ['203.0.113.7'],
    });
  });
});

describe('deriveActionNonce', () => {
  it('packs milliseconds with a six-digit suffix', () => {
    expect(deriveActionNonce(1_720_512_000_000, 123_456)).toBe('1720512000000123456');
    expect(deriveActionNonce(1, 7)).toBe('1000007');
  });
});
