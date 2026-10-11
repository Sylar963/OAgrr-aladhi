import { createAppKit, type AppKit } from '@reown/appkit';
import { mainnet } from '@reown/appkit/networks';
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import {
  getAccount,
  signMessage,
  signTypedData,
  switchChain,
  type SignTypedDataParameters,
} from '@wagmi/core';
import { getAddress, type Address, type Hex } from 'viem';

interface WalletKit {
  modal: AppKit;
  adapter: WagmiAdapter;
}

let kit: WalletKit | null = null;

function getWalletKit(): WalletKit {
  if (kit != null) return kit;
  const projectId = import.meta.env.VITE_REOWN_PROJECT_ID;
  if (!projectId) {
    throw new Error('Wallet connect is not configured on this deployment.');
  }
  const networks: [typeof mainnet] = [mainnet];
  const adapter = new WagmiAdapter({ networks, projectId });
  const modal = createAppKit({
    adapters: [adapter],
    networks,
    projectId,
    metadata: {
      name: 'oggregator',
      description: 'Options aggregator',
      url: window.location.origin,
      icons: [],
    },
    // Email and social logins mint a fresh embedded wallet, which owns no venue
    // accounts; only the user's existing wallet can authorize a session key.
    features: {
      analytics: false,
      email: false,
      socials: false,
      swaps: false,
      onramp: false,
      send: false,
      history: false,
    },
  });
  kit = { modal, adapter };
  return kit;
}

function connectedAddress(adapter: WagmiAdapter): Address | null {
  const account = getAccount(adapter.wagmiConfig);
  return account.status === 'connected' ? getAddress(account.address) : null;
}

export async function connectWallet(): Promise<Address> {
  const { modal, adapter } = getWalletKit();
  const existing = connectedAddress(adapter);
  if (existing != null) return existing;

  return new Promise<Address>((resolve, reject) => {
    let opened = false;
    const unsubscribers: Array<() => void> = [];
    const finish = (settle: () => void) => {
      for (const unsubscribe of unsubscribers) unsubscribe();
      settle();
    };
    unsubscribers.push(
      modal.subscribeAccount(() => {
        const address = connectedAddress(adapter);
        if (address == null) return;
        void modal.close();
        finish(() => resolve(address));
      }),
      modal.subscribeState((state) => {
        if (state.open) {
          opened = true;
          return;
        }
        if (opened && connectedAddress(adapter) == null) {
          finish(() => reject(new Error('Wallet connection was cancelled.')));
        }
      }),
    );
    void modal.open({ view: 'Connect' });
  });
}

async function ensureChain(adapter: WagmiAdapter, chainId: number): Promise<void> {
  if (getAccount(adapter.wagmiConfig).chainId === chainId) return;
  await switchChain(adapter.wagmiConfig, { chainId: chainId as typeof mainnet.id });
}

export async function signWalletMessage(message: string): Promise<Hex> {
  const { adapter } = getWalletKit();
  return signMessage(adapter.wagmiConfig, { message });
}

export async function signWalletTypedData(
  typedData: Omit<SignTypedDataParameters, 'account' | 'connector'>,
): Promise<Hex> {
  const { adapter } = getWalletKit();
  // Wallets refuse typed data whose domain chainId differs from the active chain.
  const chainId = Number(typedData.domain?.chainId ?? mainnet.id);
  await ensureChain(adapter, chainId);
  return signTypedData(adapter.wagmiConfig, typedData as SignTypedDataParameters);
}
