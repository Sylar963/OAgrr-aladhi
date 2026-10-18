import type { VenueCredentialsStore } from '@oggregator/db';
import { type VenueCredentialCipher, venueCredentialContext } from './venue-credential-cipher.js';

export interface RewrapReport {
  rewrapped: number;
  current: number;
  changedConcurrently: number;
  failed: Array<{ accountId: string; venue: string; environment: string; error: string }>;
}

/** Re-encrypts every legacy or retired-key row with the current key and its row context. */
export async function rewrapVenueCredentials(
  store: Pick<VenueCredentialsStore, 'listAll' | 'replaceEncrypted'>,
  cipher: VenueCredentialCipher,
): Promise<RewrapReport> {
  const report: RewrapReport = { rewrapped: 0, current: 0, changedConcurrently: 0, failed: [] };
  for (const row of await store.listAll()) {
    if (!cipher.needsRewrap(row.encryptedCredentials)) {
      report.current += 1;
      continue;
    }
    const context = venueCredentialContext(row.accountId, row.venue, row.environment);
    try {
      const plaintext = cipher.decrypt<unknown>(row.encryptedCredentials, context);
      const next = cipher.encrypt(plaintext, context);
      const replaced = await store.replaceEncrypted(
        row.accountId,
        row.venue,
        row.environment,
        row.encryptedCredentials,
        next,
      );
      if (replaced) report.rewrapped += 1;
      else report.changedConcurrently += 1;
    } catch (error) {
      report.failed.push({
        accountId: row.accountId,
        venue: row.venue,
        environment: row.environment,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return report;
}
