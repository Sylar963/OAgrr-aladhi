export type DxEventType = 'Quote' | 'Greeks' | 'Trade' | 'Summary';

export const ACCEPT_EVENT_FIELDS: Record<DxEventType, string[]> = {
  Quote: ['eventType', 'eventSymbol', 'bidPrice', 'askPrice', 'bidSize', 'askSize'],
  Greeks: ['eventType', 'eventSymbol', 'volatility', 'delta', 'gamma', 'theta', 'rho', 'vega'],
  Trade: ['eventType', 'eventSymbol', 'price', 'dayVolume', 'size'],
  Summary: ['eventType', 'eventSymbol', 'openInterest', 'prevDayClosePrice'],
};

export interface DxSub {
  type: DxEventType;
  symbol: string;
}

export function buildSetup() {
  return { type: 'SETUP', channel: 0, version: '0.1-DXF-JS/0.3.0', keepaliveTimeout: 60, acceptKeepaliveTimeout: 60 };
}

export function buildAuth(token: string) {
  return { type: 'AUTH', channel: 0, token };
}

export function buildChannelRequest(channel: number) {
  return { type: 'CHANNEL_REQUEST', channel, service: 'FEED', parameters: { contract: 'AUTO' } };
}

export function buildFeedSetup(channel: number) {
  return {
    type: 'FEED_SETUP',
    channel,
    acceptAggregationPeriod: 0.1,
    acceptDataFormat: 'COMPACT' as const,
    acceptEventFields: ACCEPT_EVENT_FIELDS,
  };
}

export function buildSubscribe(channel: number, subs: DxSub[], action: 'add' | 'remove') {
  return { type: 'FEED_SUBSCRIPTION', channel, [action]: subs } as {
    type: 'FEED_SUBSCRIPTION'; channel: number; add?: DxSub[]; remove?: DxSub[];
  };
}

export function buildKeepalive() {
  return { type: 'KEEPALIVE', channel: 0 };
}

export interface DxEvent {
  eventType: DxEventType;
  eventSymbol: string;
  [field: string]: string | number | null;
}

function coerce(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    if (v === 'NaN' || v === 'Infinity' || v === '-Infinity') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function parseFeedData(frame: unknown): DxEvent[] {
  if (typeof frame !== 'object' || frame == null) return [];
  const f = frame as { type?: unknown; data?: unknown };
  if (f.type !== 'FEED_DATA' || !Array.isArray(f.data) || f.data.length < 2) return [];

  const eventName = f.data[0] as DxEventType;
  const flat = f.data[1];
  if (!Array.isArray(flat)) return [];
  const fields = ACCEPT_EVENT_FIELDS[eventName];
  if (fields == null) return [];

  const events: DxEvent[] = [];
  for (let i = 0; i + fields.length <= flat.length; i += fields.length) {
    const chunk = flat.slice(i, i + fields.length);
    const symbol = chunk[1];
    if (typeof symbol !== 'string') continue;
    const ev: DxEvent = { eventType: eventName, eventSymbol: symbol };
    for (let j = 2; j < fields.length; j++) {
      ev[fields[j]!] = coerce(chunk[j]);
    }
    events.push(ev);
  }
  return events;
}
