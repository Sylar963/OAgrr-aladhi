import type { DxEvent } from './codec.js';
import type { TradfiStore, TradfiLiveQuote } from '../runtime/store.js';
import type { TradfiFlowBook } from '../runtime/flow-book.js';

export function applyEvent(
  store: TradfiStore,
  ev: DxEvent,
  ts: number,
  flowBook?: TradfiFlowBook,
): void {
  const inst = store.getInstrument(ev.eventSymbol);
  if (ev.eventType === 'Trade') {
    const dayId = numOrNull(ev.dayId);
    if (dayId != null) store.setTradingDay(inst?.underlying ?? ev.eventSymbol, dayId);
  }

  // Underlying symbol (no option instrument) -> spot price.
  if (inst == null) {
    if (ev.eventType === 'Summary') {
      const prevClose = positiveOrNull(ev.prevDayClosePrice);
      if (prevClose != null) {
        store.mergeSession(ev.eventSymbol, { prevClose, prevDayId: numOrNull(ev.prevDayId), ts });
      }
      return;
    }
    const price =
      (ev.eventType === 'Trade' ? ev.price : null) ??
      (ev.eventType === 'Quote' ? mid(ev.bidPrice, ev.askPrice) : null);
    if (typeof price === 'number') store.setSpot(ev.eventSymbol, price);
    if (ev.eventType === 'Trade') {
      const lastTrade = positiveOrNull(ev.price);
      if (lastTrade != null) store.mergeSession(ev.eventSymbol, { lastTrade, ts });
    }
    return;
  }

  const patch: Partial<TradfiLiveQuote> & { ts: number } = { ts };

  switch (ev.eventType) {
    case 'Quote': {
      patch.bid = numOrNull(ev.bidPrice);
      patch.ask = numOrNull(ev.askPrice);
      patch.bidSize = numOrNull(ev.bidSize);
      patch.askSize = numOrNull(ev.askSize);
      patch.bidTime = numOrNull(ev.bidTime);
      patch.askTime = numOrNull(ev.askTime);
      patch.quoteReceivedAt = ts;
      const m = mid(ev.bidPrice, ev.askPrice);
      if (m != null) patch.mark = m;
      break;
    }
    case 'Greeks': {
      patch.iv = numOrNull(ev.volatility);
      patch.delta = numOrNull(ev.delta);
      patch.gamma = numOrNull(ev.gamma);
      patch.theta = numOrNull(ev.theta);
      patch.vega = numOrNull(ev.vega);
      patch.rho = numOrNull(ev.rho);
      break;
    }
    case 'Trade': {
      patch.last = numOrNull(ev.price);
      const dayId = numOrNull(ev.dayId);
      const previousDay = store.getQuote(ev.eventSymbol)?.volumeDayId;
      if (dayId == null || previousDay == null || dayId >= previousDay) {
        patch.volume = numOrNull(ev.dayVolume);
        patch.volumeDayId = dayId;
        patch.volumeTs = ts;
      }
      if (flowBook != null) {
        // Prevailing quote (last Quote merge) classifies aggressor side.
        const q = store.getQuote(ev.eventSymbol);
        flowBook.recordTrade(
          inst.canonical,
          numOrNull(ev.price),
          numOrNull(ev.size),
          q?.bid ?? null,
          q?.ask ?? null,
          ts,
        );
      }
      break;
    }
    case 'Summary': {
      patch.openInterest = numOrNull(ev.openInterest);
      patch.oiTs = ts;
      break;
    }
  }

  store.mergeQuote(ev.eventSymbol, patch);
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function positiveOrNull(v: unknown): number | null {
  const n = numOrNull(v);
  return n != null && n > 0 ? n : null;
}

function mid(bid: unknown, ask: unknown): number | null {
  const b = numOrNull(bid);
  const a = numOrNull(ask);
  return b != null && a != null ? (b + a) / 2 : null;
}
