import { connectVenue as connectVenueRequest } from '@features/portfolio/api';
import type { VenueId } from '@oggregator/protocol';
import { loadVenueCreds, removeVenueCreds } from './venue-credentials';

export {
  connectVenue,
  disconnectVenue,
  listVenueConnections,
  restoreVenueConnections,
  venueStatus,
} from '@features/portfolio/api';
export type {
  VenueConnectionState,
  VenueConnectRequest,
} from '@features/portfolio/api';

function readLegacyAccountIdentifier(): string | null {
  try {
    return localStorage.getItem('paperAccountId');
  } catch {
    return null;
  }
}

export async function migrateLegacyBrowserVenueCredentials(
  accountId: string,
  token: string,
): Promise<void> {
  if (readLegacyAccountIdentifier() !== accountId) return;
  const migrations: Promise<void>[] = [];

  const derive = loadVenueCreds('derive');
  if (derive != null) {
    const walletAddress = derive.fields.walletAddress;
    const signerPrivateKey = derive.fields.privateKeyPem;
    const subaccountId = Number(derive.fields.subaccountId);
    if (walletAddress && signerPrivateKey && Number.isFinite(subaccountId) && subaccountId > 0) {
      migrations.push(
        connectVenueRequest(
          'derive',
          {
            walletAddress,
            signerPrivateKey,
            subaccountId,
          },
          token,
        ).then(() => removeVenueCreds('derive')),
      );
    }
  }

  const thalex = loadVenueCreds('thalex');
  if (thalex != null) {
    const kid = thalex.fields.kid;
    const privateKeyPem = thalex.fields.privateKeyPem;
    const account = thalex.fields.account?.trim();
    if (kid && privateKeyPem) {
      migrations.push(
        connectVenueRequest(
          'thalex',
          {
            kid,
            privateKeyPem,
            ...(account ? { account } : {}),
          },
          token,
        ).then(() => removeVenueCreds('thalex')),
      );
    }
  }

  await Promise.allSettled(migrations);
  if (loadVenueCreds('derive') == null && loadVenueCreds('thalex') == null) {
    try {
      localStorage.removeItem('paperAccountId');
    } catch {}
  }
}

export function isPrivateVenue(venue: VenueId): venue is 'derive' | 'thalex' {
  return venue === 'derive' || venue === 'thalex';
}
