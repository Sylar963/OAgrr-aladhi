import { describe, expect, it } from 'vitest';
import type { CachedInstrument } from './shared/sdk-base.js';
import { BinanceWsAdapter } from './binance/ws-client.js';
import { BybitWsAdapter } from './bybit/ws-client.js';
import { DeribitWsAdapter } from './deribit/ws-client.js';
import { DeriveWsAdapter } from './derive/ws-client.js';
import { OkxWsAdapter } from './okx/ws-client.js';

type InstrumentParser = {
  parseInstrument(item: unknown): CachedInstrument | null;
};

function parse(adapter: object, item: unknown): CachedInstrument | null {
  return (adapter as InstrumentParser).parseInstrument(item);
}

describe('venue execution metadata', () => {
  it('maps Deribit contract and lot metadata only when contract semantics are explicit', () => {
    const adapter = new DeribitWsAdapter();
    const item = {
      instrument_name: 'BTC-26JUN26-70000-C',
      strike: 70_000,
      option_type: 'call',
      settlement_currency: 'BTC',
      quote_currency: 'BTC',
      instrument_type: 'reversed',
      contract_size: 1,
      tick_size: 0.0001,
      min_trade_amount: 0.1,
      maker_commission: 0.0002,
      taker_commission: 0.0003,
    };

    expect(parse(adapter, item)).toMatchObject({
      contractMultiplierBase: 1,
      minQty: 0.1,
      lotSize: 0.1,
    });
    expect(parse(adapter, { ...item, contract_size: undefined })?.contractMultiplierBase).toBeNull();
  });

  it('requires both OKX multiplier factors and a base-denominated contract value', () => {
    const adapter = new OkxWsAdapter();
    const item = {
      instId: 'BTC-USD-260626-70000-C',
      instType: 'OPTION',
      settleCcy: 'BTC',
      ctVal: '0.01',
      ctMult: '2',
      ctValCcy: 'BTC',
      optType: 'C',
      stk: '70000',
      tickSz: '0.0001',
      lotSz: '1',
      minSz: '1',
    };

    expect(parse(adapter, item)).toMatchObject({
      contractSize: 0.02,
      contractMultiplierBase: 0.02,
      minQty: 1,
      lotSize: 1,
    });
    expect(parse(adapter, { ...item, ctMult: undefined })?.contractMultiplierBase).toBeNull();
    expect(parse(adapter, { ...item, ctValCcy: 'USD' })?.contractMultiplierBase).toBeNull();
  });

  it('maps Bybit quantities as base-denominated unit contracts', () => {
    const instrument = parse(new BybitWsAdapter(), {
      symbol: 'BTC-26JUN26-70000-C-USDC',
      status: 'Trading',
      baseCoin: 'BTC',
      quoteCoin: 'USDC',
      settleCoin: 'USDC',
      optionsType: 'Call',
      launchTime: '1',
      deliveryTime: '1782451200000',
      deliveryFeeRate: '0.00015',
      priceFilter: { minPrice: '0.1', maxPrice: '1000000', tickSize: '0.1' },
      lotSizeFilter: { maxOrderQty: '100', minOrderQty: '0.01', qtyStep: '0.01' },
    });

    expect(instrument).toMatchObject({
      contractMultiplierBase: 1,
      minQty: 0.01,
      lotSize: 0.01,
    });
  });

  it('sources Binance minimum and step from the same LOT_SIZE filter', () => {
    const item = {
      symbol: 'BTC-260626-70000-C',
      status: 'TRADING',
      quoteAsset: 'USDT',
      unit: 0.01,
      minQty: '99',
      filters: [
        { filterType: 'PRICE_FILTER', tickSize: '0.1' },
        { filterType: 'LOT_SIZE', minQty: '0.1', stepSize: '0.05' },
      ],
    };

    expect(parse(new BinanceWsAdapter(), item)).toMatchObject({
      contractMultiplierBase: 0.01,
      minQty: 0.1,
      lotSize: 0.05,
    });
    expect(
      parse(new BinanceWsAdapter(), { ...item, quoteAsset: undefined })?.contractMultiplierBase,
    ).toBeNull();
  });

  it('maps Derive amount increments as base-denominated unit contracts', () => {
    const instrument = parse(new DeriveWsAdapter(), {
      instrument_name: 'BTC-20260626-70000-C',
      instrument_type: 'option',
      is_active: true,
      quote_currency: 'USDC',
      option_details: {
        expiry: Date.UTC(2026, 5, 26) / 1000,
        index: 'BTC-USD',
        option_type: 'C',
        strike: '70000',
      },
      tick_size: '0.1',
      minimum_amount: '0.01',
      amount_step: '0.005',
      maker_fee_rate: '0.0002',
      taker_fee_rate: '0.0003',
    });

    expect(instrument).toMatchObject({
      contractMultiplierBase: 1,
      minQty: 0.01,
      lotSize: 0.005,
    });
  });
});
