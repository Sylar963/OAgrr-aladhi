import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { KeyCipher } from '../cipher.js';
import { loadConfig } from '../config.js';
import { Journal } from '../journal.js';
import { actorLabel, StepUpSecretStore } from '../step-up.js';
import { base32Encode, generateTotpSecret, matchTotp, otpauthUri } from '../totp.js';

/**
 * Run on the host as the daemon user. Enrolls an authenticator app for one user (charter D10).
 * The secret is shown once on this terminal and stored only after the user proves their app
 * produces matching codes. The daemon reads the secret file on every check, so no restart is needed.
 */
const config = loadConfig(process.env);
const rl = createInterface({ input, output });

async function ask(question: string): Promise<string> {
  const answer = (await rl.question(`${question}: `)).trim();
  if (!answer) throw new Error(`${question} is required`);
  return answer;
}

try {
  const clerkUserId = await ask('Clerk user id (user_...)');
  const accountId = await ask('oggregator account id (acct_...)');
  const actor = { clerkUserId, accountId };
  const store = new StepUpSecretStore(
    config.stateDir,
    new KeyCipher(config.keyId, config.keyEncryptionKey),
  );

  if (store.isEnrolled(actor)) {
    const answer = (await rl.question('An authenticator is already enrolled. Replace it? [type yes]: '))
      .trim()
      .toLowerCase();
    if (answer !== 'yes') throw new Error('Kept the existing authenticator');
  }

  const secret = generateTotpSecret();
  console.log('\nAdd this to the authenticator app (scan the URI as a QR code, or type the key):');
  console.log(`  ${otpauthUri(secret, actorLabel(actor))}`);
  console.log(`  key: ${base32Encode(secret)}\n`);

  let confirmed = false;
  for (let attempt = 0; attempt < 3 && !confirmed; attempt += 1) {
    const code = await ask('Current 6-digit code from the app');
    confirmed = matchTotp(secret, code, Date.now()) !== null;
    if (!confirmed) console.log('That code does not match; check the app clock and try again.');
  }
  if (!confirmed) throw new Error('Not enrolled: no matching code');

  store.enroll(actor, secret);
  const journal = Journal.open(config.stateDir);
  journal.append(actorLabel(actor), 'step_up_enrolled', {
    operatorUid: process.getuid?.() ?? null,
  });
  journal.close();
  console.log('\nEnrolled. Clear this terminal\'s scrollback: it contains the secret.');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  rl.close();
}
