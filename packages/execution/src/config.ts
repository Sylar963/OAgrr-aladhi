import { isAbsolute } from 'node:path';
import { z } from 'zod';

const SecretKeySchema = z
  .string()
  .trim()
  .refine((raw) => decodeKey(raw).length === 32, 'must decode to exactly 32 bytes');

const optional = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value : null));

const AbsolutePathSchema = z.string().trim().refine(isAbsolute, 'must be an absolute path');

const EnvSchema = z.object({
  EXECUTION_SOCKET_PATH: AbsolutePathSchema,
  EXECUTION_SOCKET_HMAC_KEY: SecretKeySchema,
  EXECUTION_STATE_DIR: AbsolutePathSchema,
  EXECUTION_KEY_ENCRYPTION_KEY: SecretKeySchema,
  EXECUTION_KEY_ID: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{1,32}$/)
    .default('k1'),
  EXECUTION_VENUE: z.enum(['stub']).default('stub'),
  LIVE_ALERT_TELEGRAM_BOT_TOKEN: optional,
  LIVE_ALERT_TELEGRAM_CHAT_ID: optional,
  LIVE_ALERT_RESEND_API_KEY: optional,
  LIVE_ALERT_EMAIL_FROM: optional,
  LIVE_ALERT_EMAIL_TO: optional,
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export interface ExecutionConfig {
  socketPath: string;
  hmacKey: Buffer;
  stateDir: string;
  keyEncryptionKey: Buffer;
  keyId: string;
  venue: 'stub';
  telegram: { botToken: string; chatId: string } | null;
  email: { apiKey: string; from: string; to: string } | null;
  logLevel: string;
}

export function decodeKey(raw: string): Buffer {
  const trimmed = raw.trim();
  return /^[a-fA-F0-9]{64}$/.test(trimmed)
    ? Buffer.from(trimmed, 'hex')
    : Buffer.from(trimmed, 'base64');
}

/** Throws with every problem listed; the daemon must not start half-configured. */
export function loadConfig(env: NodeJS.ProcessEnv): ExecutionConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid execution daemon configuration:\n  ${problems.join('\n  ')}`);
  }
  const e = parsed.data;
  const telegram =
    e.LIVE_ALERT_TELEGRAM_BOT_TOKEN && e.LIVE_ALERT_TELEGRAM_CHAT_ID
      ? { botToken: e.LIVE_ALERT_TELEGRAM_BOT_TOKEN, chatId: e.LIVE_ALERT_TELEGRAM_CHAT_ID }
      : null;
  const email =
    e.LIVE_ALERT_RESEND_API_KEY && e.LIVE_ALERT_EMAIL_FROM && e.LIVE_ALERT_EMAIL_TO
      ? { apiKey: e.LIVE_ALERT_RESEND_API_KEY, from: e.LIVE_ALERT_EMAIL_FROM, to: e.LIVE_ALERT_EMAIL_TO }
      : null;
  return {
    socketPath: e.EXECUTION_SOCKET_PATH,
    hmacKey: decodeKey(e.EXECUTION_SOCKET_HMAC_KEY),
    stateDir: e.EXECUTION_STATE_DIR,
    keyEncryptionKey: decodeKey(e.EXECUTION_KEY_ENCRYPTION_KEY),
    keyId: e.EXECUTION_KEY_ID,
    venue: e.EXECUTION_VENUE,
    telegram,
    email,
    logLevel: e.LOG_LEVEL,
  };
}
