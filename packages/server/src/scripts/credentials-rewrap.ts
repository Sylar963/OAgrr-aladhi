import { PostgresVenueCredentialsStore } from '@oggregator/db';
import { cipherFromEnv } from '../venue-credential-cipher.js';
import { rewrapVenueCredentials } from '../venue-credential-rewrap.js';

const databaseUrl = process.env['DATABASE_URL'];
const cipher = cipherFromEnv(process.env);
if (!databaseUrl || !cipher) {
  console.error('DATABASE_URL and VENUE_CREDENTIALS_ENCRYPTION_KEY are required');
  process.exit(1);
}

const store = PostgresVenueCredentialsStore.fromConnectionString(databaseUrl);
try {
  const report = await rewrapVenueCredentials(store, cipher);
  console.log(JSON.stringify(report, null, 2));
  if (report.failed.length > 0) process.exitCode = 1;
} finally {
  await store.dispose();
}
