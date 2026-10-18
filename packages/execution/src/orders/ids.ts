import { randomBytes } from 'node:crypto';

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
// 62^22 > 2^128, so 22 characters hold any 128-bit id.
const LABEL_DIGITS = 22;
export const ORDER_LABEL_PREFIX = 'ogg_';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** Thalex labels: at most 32 bytes from this set (`info.md`, Labels). */
const THALEX_LABEL_PATTERN = /^[A-Za-z0-9<>|_-]{1,32}$/;

/** UUIDv7: 48-bit millisecond timestamp, then randomness, so ids sort by creation time. */
export function newOrderId(nowMs: number = Date.now()): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(nowMs, 0, 6);
  bytes[6] = 0x70 | (bytes[6]! & 0x0f);
  bytes[8] = 0x80 | (bytes[8]! & 0x3f);
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function isOrderId(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** Our order id carried in the Thalex label, so an order is recognisable after any reconnect. */
export function orderLabel(orderId: string): string {
  if (!isOrderId(orderId)) throw new Error('Order ids must be UUIDv7');
  let value = BigInt(`0x${orderId.replaceAll('-', '')}`);
  let digits = '';
  while (value > 0n) {
    digits = BASE62[Number(value % 62n)] + digits;
    value /= 62n;
  }
  return ORDER_LABEL_PREFIX + digits.padStart(LABEL_DIGITS, '0');
}

/** Null for anything we did not label: UI orders, bot orders, other tools. */
export function orderIdFromLabel(label: string | number | undefined | null): string | null {
  if (typeof label !== 'string' || !label.startsWith(ORDER_LABEL_PREFIX)) return null;
  const digits = label.slice(ORDER_LABEL_PREFIX.length);
  if (digits.length !== LABEL_DIGITS) return null;
  let value = 0n;
  for (const char of digits) {
    const index = BASE62.indexOf(char);
    if (index === -1) return null;
    value = value * 62n + BigInt(index);
  }
  if (value >= 1n << 128n) return null;
  const hex = value.toString(16).padStart(32, '0');
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return isOrderId(id) ? id : null;
}

export function isValidThalexLabel(label: string): boolean {
  return THALEX_LABEL_PATTERN.test(label) && Buffer.byteLength(label, 'utf8') <= 32;
}
