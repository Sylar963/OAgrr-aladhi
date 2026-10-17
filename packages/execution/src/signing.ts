import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  canonicalJson,
  type ExecutionEnvelope,
  type UnsignedExecutionEnvelope,
} from '@oggregator/protocol';

export function signEnvelope(unsigned: UnsignedExecutionEnvelope, key: Buffer): ExecutionEnvelope {
  const hmac = createHmac('sha256', key).update(canonicalJson(unsigned)).digest('hex');
  return { ...unsigned, hmac };
}

export function verifyEnvelope(envelope: ExecutionEnvelope, key: Buffer): boolean {
  const { hmac, ...unsigned } = envelope;
  const expected = createHmac('sha256', key).update(canonicalJson(unsigned)).digest();
  const provided = Buffer.from(hmac, 'hex');
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}
