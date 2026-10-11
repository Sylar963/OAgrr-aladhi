import { confirmDeriveSessionKey, issueDeriveSessionKey } from '@features/portfolio/api';
import type { Address } from 'viem';

import { connectWallet, signWalletMessage, signWalletTypedData } from './appkit';
import {
  buildReadOnlySessionKeyAction,
  DeriveLoginResultSchema,
  DeriveRpcSocket,
  setSessionKeyParams,
} from './derive-session-key';

export interface DeriveWalletSession {
  walletAddress: Address;
  subaccountIds: number[];
  authorize: (subaccountId: number) => Promise<void>;
  cancel: () => void;
}

function randomNonceSuffix(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000;
}

// The owner's login and set_session_key signatures go straight from the wallet to
// Derive; our server only ever sees the wallet address and the subaccount choice.
export async function startDeriveWalletConnect(): Promise<DeriveWalletSession> {
  const walletAddress = await connectWallet();
  const socket = await DeriveRpcSocket.open();
  try {
    const timestamp = String(Date.now());
    const signature = await signWalletMessage(timestamp);
    let loginResult: unknown;
    try {
      loginResult = await socket.call('public/login', {
        wallet: walletAddress,
        timestamp,
        signature,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Derive login failed';
      throw new Error(`${reason}. If the sign-in took long to approve, try again.`);
    }
    const login = DeriveLoginResultSchema.safeParse(loginResult);
    if (!login.success || login.data.length === 0) {
      throw new Error('This wallet has no Derive subaccounts.');
    }

    return {
      walletAddress,
      subaccountIds: login.data,
      cancel: () => socket.close(),
      authorize: async (subaccountId) => {
        try {
          const grant = await issueDeriveSessionKey();
          const action = buildReadOnlySessionKeyAction({
            owner: walletAddress,
            grant,
            subaccountId,
            nowMs: Date.now(),
            nonceSuffix: randomNonceSuffix(),
          });
          const actionSignature = await signWalletTypedData(action.typedData);
          await socket.call(
            'private/set_session_key',
            setSessionKeyParams(action, grant, subaccountId, actionSignature),
          );
        } finally {
          socket.close();
        }
        await confirmDeriveSessionKey({ walletAddress, subaccountId });
      },
    };
  } catch (error) {
    socket.close();
    throw error;
  }
}
