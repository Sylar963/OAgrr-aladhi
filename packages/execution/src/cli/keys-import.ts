import { readFileSync } from 'node:fs';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { KeyCipher } from '../cipher.js';
import { loadConfig } from '../config.js';
import { Journal } from '../journal.js';
import { KeyStore, ThalexEnvSchema } from '../key-store.js';

/**
 * Run on the host as the daemon user. The PEM is read from a file path, never pasted, and the
 * file should be deleted after import. Permissions are confirmed by the operator in the Thalex
 * UI because the API offers no way for a key to report its own scopes.
 */
const config = loadConfig(process.env);
const rl = createInterface({ input, output });

async function ask(question: string): Promise<string> {
  const answer = (await rl.question(`${question}: `)).trim();
  if (!answer) throw new Error(`${question} is required`);
  return answer;
}

async function confirm(question: string): Promise<void> {
  const answer = (await rl.question(`${question} [type yes]: `)).trim().toLowerCase();
  if (answer !== 'yes') throw new Error(`Not confirmed: ${question}`);
}

try {
  const clerkUserId = await ask('Owner Clerk user id (user_...)');
  const accountId = await ask('Owner oggregator account id (acct_...)');
  const env = ThalexEnvSchema.parse(await ask('Thalex environment (test|prod)'));
  const kid = await ask('Thalex key name (kid)');
  const venueAccount = await ask('Thalex subaccount number');
  const pemPath = await ask('Path to the unencrypted RSA private key PEM');
  const ipWhitelist = (await ask('IP whitelist set on the key (comma-separated)'))
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

  console.log('\nCheck the key in the Thalex web UI (Account settings > API keys) before continuing.');
  await confirm(`Key ${kid} has trading permission on ${venueAccount}`);
  await confirm(`Key ${kid} has NO withdrawal permission on any account`);
  await confirm(`Key ${kid} IP whitelist is exactly: ${ipWhitelist.join(', ')}`);

  const store = new KeyStore(config.stateDir, new KeyCipher(config.keyId, config.keyEncryptionKey));
  const attestedAt = new Date().toISOString();
  const meta = store.import({
    binding: { clerkUserId, accountId },
    env,
    kid,
    venueAccount,
    privateKeyPem: readFileSync(pemPath, 'utf8'),
    attestation: { mayTrade: true, mayWithdraw: false, ipWhitelist, attestedAt },
  });

  const journal = Journal.open(config.stateDir);
  journal.append(`${clerkUserId}/${accountId}`, 'key_imported', {
    venue: meta.venue,
    env: meta.env,
    kid: meta.kid,
    venueAccount: meta.venueAccount,
    attestation: meta.attestation,
    operatorUid: process.getuid?.() ?? null,
  });
  journal.close();

  console.log(`\nImported Thalex ${env} key ${kid}. Delete ${pemPath} now.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  rl.close();
}
