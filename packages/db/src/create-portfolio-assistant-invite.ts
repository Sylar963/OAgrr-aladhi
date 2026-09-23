import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { setDefaultResultOrder } from 'node:dns';

setDefaultResultOrder('ipv4first');

const databaseUrl = process.env['DATABASE_URL'];
const inviteHashSecret = process.env['PORTFOLIO_ASSISTANT_INVITE_HASH_SECRET'];

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required to create a Portfolio Assistant invite');
}
if (!inviteHashSecret) {
  throw new Error(
    'PORTFOLIO_ASSISTANT_INVITE_HASH_SECRET is required to create a Portfolio Assistant invite',
  );
}

const { Pool } = await import('pg');
const code = `OGG-PA-${randomBytes(18).toString('base64url')}`;
const digest = createHmac('sha256', inviteHashSecret).update(code).digest('hex');
const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000);
const pool = new Pool({ connectionString: databaseUrl });

try {
  await pool.query(
    `INSERT INTO feature_invites
      (id, feature_key, code_digest, code_prefix, max_redemptions, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      `portfolio-beta-${randomUUID()}`,
      'portfolio_assistant_beta',
      digest,
      code.slice(0, 12),
      1,
      expiresAt,
    ],
  );
  console.log('Portfolio Assistant beta invite created.');
  console.log(`Code: ${code}`);
  console.log('Maximum redemptions: 1');
  console.log(`Expires: ${expiresAt.toISOString()}`);
  console.log('This is the only time the complete code is displayed.');
} finally {
  await pool.end();
}
