import type { DxSub, DxEventType } from './codec.js';

const CONTRACT_EVENTS: DxEventType[] = ['Quote', 'Greeks', 'Trade', 'Summary'];
const UNDERLYING_EVENTS: DxEventType[] = ['Quote', 'Trade'];

export function chainSubscriptions(streamerSymbols: string[]): DxSub[] {
  const subs: DxSub[] = [];
  for (const symbol of streamerSymbols) {
    for (const type of CONTRACT_EVENTS) subs.push({ type, symbol });
  }
  return subs;
}

export function underlyingSubscriptions(underlyings: string[]): DxSub[] {
  const subs: DxSub[] = [];
  for (const symbol of underlyings) {
    for (const type of UNDERLYING_EVENTS) subs.push({ type, symbol });
  }
  return subs;
}
