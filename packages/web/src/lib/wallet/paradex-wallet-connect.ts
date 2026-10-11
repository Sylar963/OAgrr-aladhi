import { connectVenue, fetchParadexTokenSettings } from '@features/portfolio/api';

import { connectWallet, signWalletMessage } from './appkit';
import {
  buildParadexSiweAuthMessage,
  createParadexReadonlyToken,
  lookupParadexEvmAccount,
  PARADEX_PROD,
  paradexEvmAuth,
} from './paradex-readonly-token';

export class ParadexStarknetAccountError extends Error {
  constructor() {
    super(
      'This wallet’s Paradex account was created before wallet sign-in, so it cannot connect this way. Create a read-only key in Paradex (Settings → Key Management → Read-only) and paste it below.',
    );
    this.name = 'ParadexStarknetAccountError';
  }
}

function randomNonce(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}

// The wallet's sign-in and the short-lived session token stay in the browser; only
// the read-only key Paradex mints from them is sent to our server.
export async function connectParadexWallet(): Promise<void> {
  const walletAddress = await connectWallet();
  const account = await lookupParadexEvmAccount(PARADEX_PROD, walletAddress);
  if (account.kind === 'starknet_linked') throw new ParadexStarknetAccountError();
  if (account.kind === 'not_onboarded') throw new Error('This wallet has no Paradex account.');

  const settings = await fetchParadexTokenSettings();
  const siweMessage = buildParadexSiweAuthMessage({
    env: PARADEX_PROD,
    address: walletAddress,
    nonce: randomNonce(),
    nowMs: Date.now(),
  });
  const sessionJwt = await paradexEvmAuth({
    env: PARADEX_PROD,
    paradexAccount: account.address,
    siweMessage,
    signature: await signWalletMessage(siweMessage),
  });
  const readonlyToken = await createParadexReadonlyToken({
    env: PARADEX_PROD,
    sessionJwt,
    settings,
  });
  await connectVenue('paradex', { readonlyToken });
}
