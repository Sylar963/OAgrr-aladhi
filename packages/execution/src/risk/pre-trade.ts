import type { RiskLimits } from './limits.js';

export type InstrumentKind = 'option' | 'delta1';
export type Direction = 'buy' | 'sell';

export interface OrderIntent {
  instrument: string;
  direction: Direction;
  amount: number;
  /** Limit price. L2 only places limit orders. */
  price: number;
}

export interface InstrumentSpec {
  name: string;
  kind: InstrumentKind;
  underlying: string;
  active: boolean;
  tickSize: number;
  volumeTickSize: number;
  minOrderAmount: number;
}

export interface MarketSnapshot {
  markPrice: number;
  underlyingPrice: number;
  /** Thalex's own collar; null when the instrument has none. */
  collarLow: number | null;
  collarHigh: number | null;
  receivedAt: number;
}

export interface OpenOrderExposure {
  kind: InstrumentKind;
  underlying: string;
  direction: Direction;
  remainingAmount: number;
}

export interface AccountState {
  armed: boolean;
  /** Session connected, reconciled, not inside a `system.reconnect` window. */
  sessionReady: boolean;
  openOrders: OpenOrderExposure[];
  /** Orders this actor sent in the trailing second. */
  ordersInLastSecond: number;
}

export interface CheckContext {
  instrument: InstrumentSpec | null;
  market: MarketSnapshot | null;
  account: AccountState;
  limits: RiskLimits;
  limitsVersion: string;
  now: number;
}

export interface RiskCheck {
  name: string;
  /** `hard` checks (armed, session, instrument, ticks, fresh data) block in every mode. */
  kind: 'hard' | 'limit';
  passed: boolean;
  detail: string;
}

export interface RiskDecision {
  /** Hard checks always block; limit checks block only in `enforce` mode. */
  allowed: boolean;
  mode: RiskLimits['mode'];
  limitsVersion: string;
  checks: RiskCheck[];
}

// Thalex rounds JSON numbers to 8 digits before checking ticks; never compare floats directly.
const TICK_EPSILON = 1e-6;

export function isOnTick(value: number, tick: number): boolean {
  const ticks = value / tick;
  return Math.abs(ticks - Math.round(ticks)) < TICK_EPSILON;
}

/**
 * Pure pre-trade checks (charter §6.8). Every check runs and is reported, so the journal shows
 * the full picture even when the first one already failed. `required_margin_for_order` needs the
 * venue and is checked separately by the session.
 */
export function checkOrder(intent: OrderIntent, ctx: CheckContext): RiskDecision {
  const { instrument, market, account, limits, now } = ctx;
  const checks: RiskCheck[] = [];
  const hard = (name: string, passed: boolean, detail: string) => {
    checks.push({ name, kind: 'hard', passed, detail });
  };
  const limit = (name: string, passed: boolean, detail: string) => {
    checks.push({ name, kind: 'limit', passed, detail });
  };

  hard('armed', account.armed, account.armed ? 'armed' : 'live trading is not armed');
  hard(
    'session_ready',
    account.sessionReady,
    account.sessionReady ? 'ready' : 'session is not connected and reconciled',
  );

  const validNumbers =
    Number.isFinite(intent.amount) && intent.amount > 0 && Number.isFinite(intent.price) && intent.price > 0;
  hard('valid_numbers', validNumbers, validNumbers ? 'ok' : 'amount and price must be positive');

  if (instrument === null) {
    hard('instrument', false, `unknown instrument ${intent.instrument}`);
  } else {
    hard('instrument', instrument.active, instrument.active ? 'active' : 'instrument is not active');
    hard(
      'price_tick',
      isOnTick(intent.price, instrument.tickSize),
      `price ${intent.price} on tick ${instrument.tickSize}`,
    );
    hard(
      'amount_tick',
      isOnTick(intent.amount, instrument.volumeTickSize),
      `amount ${intent.amount} on tick ${instrument.volumeTickSize}`,
    );
    hard(
      'min_amount',
      intent.amount >= instrument.minOrderAmount - TICK_EPSILON,
      `amount ${intent.amount} ≥ ${instrument.minOrderAmount}`,
    );
  }

  const fresh = market !== null && now - market.receivedAt <= limits.maxMarketAgeMs;
  hard(
    'market_fresh',
    fresh,
    market === null ? 'no market data' : `market data ${now - market.receivedAt} ms old`,
  );

  if (instrument !== null && market !== null) {
    const pct = limits.collarPct[instrument.kind] / 100;
    const ourCollar =
      intent.direction === 'buy'
        ? intent.price <= market.markPrice * (1 + pct)
        : intent.price >= market.markPrice * (1 - pct);
    limit('collar_vs_mark', ourCollar, `price ${intent.price} vs mark ${market.markPrice} ± ${pct * 100}%`);

    // collar_high bounds bids, collar_low bounds asks.
    const venueBound = intent.direction === 'buy' ? market.collarHigh : market.collarLow;
    const venueCollar =
      venueBound === null ||
      (intent.direction === 'buy' ? intent.price <= venueBound : intent.price >= venueBound);
    hard('collar_venue', venueCollar, `price ${intent.price} vs Thalex collar ${venueBound ?? 'none'}`);

    const notional = intent.amount * market.underlyingPrice;
    limit(
      'order_notional',
      notional <= limits.maxOrderNotionalUsd,
      `${Math.round(notional)} ≤ ${limits.maxOrderNotionalUsd} USD`,
    );

    const openSameSide = account.openOrders
      .filter(
        (order) =>
          order.kind === instrument.kind &&
          order.underlying === instrument.underlying &&
          order.direction === intent.direction,
      )
      .reduce((sum, order) => sum + order.remainingAmount, 0);
    const openNotional = (openSameSide + intent.amount) * market.underlyingPrice;
    const openCap = limits.maxOpenNotionalPerSideUsd[instrument.kind];
    limit(
      'open_notional',
      openNotional <= openCap,
      `${instrument.underlying} ${intent.direction} ${Math.round(openNotional)} ≤ ${openCap} USD`,
    );
  }

  limit(
    'contracts',
    intent.amount <= limits.maxContractsPerOrder,
    `${intent.amount} ≤ ${limits.maxContractsPerOrder}`,
  );
  limit(
    'open_orders',
    account.openOrders.length + 1 <= limits.maxOpenOrders,
    `${account.openOrders.length + 1} ≤ ${limits.maxOpenOrders}`,
  );
  limit(
    'order_rate',
    account.ordersInLastSecond + 1 <= limits.maxOrdersPerSecond,
    `${account.ordersInLastSecond + 1}/s ≤ ${limits.maxOrdersPerSecond}/s`,
  );

  const hardPassed = checks.every((c) => c.kind === 'limit' || c.passed);
  const limitsPassed = checks.every((c) => c.kind === 'hard' || c.passed);
  return {
    allowed: hardPassed && (limits.mode === 'observe' || limitsPassed),
    mode: limits.mode,
    limitsVersion: ctx.limitsVersion,
    checks,
  };
}
