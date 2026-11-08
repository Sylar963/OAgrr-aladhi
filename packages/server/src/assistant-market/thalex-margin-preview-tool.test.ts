import { describe, expect, it, vi } from 'vitest';
import { AssistantMarketDataReader } from './market-data-reader.js';
import { PortfolioRefStore } from './portfolio-ref.js';
import {
  runThalexMarginPreviewTool,
  ThalexMarginPreviewToolInputSchema,
} from './thalex-margin-preview-tool.js';

const NOW = Date.parse('2026-11-08T12:00:00Z');
const leg = { expiry: '2026-11-27', strike: 75_000, right: 'put', side: 'buy', size: 0.1 } as const;

function fixture(
  network: 'mainnet' | 'testnet' = 'mainnet',
  source: 'thalex' | 'manual' = 'thalex',
) {
  const refs = new PortfolioRefStore({ now: () => NOW });
  const ref = refs.mint({
    accountId: 'account-a',
    source,
    network,
    underlying: 'BTC',
    generatedAt: NOW,
  });
  const previewThalexMargin = vi.fn(async () => ({
    current: { required_margin: 1_000 },
    with_buy: { required_margin: 800 },
    with_sell: { required_margin: 1_100 },
  }));
  const portfolio = { refs, resolveHeldLegs: vi.fn(), previewThalexMargin };
  const reader = new AssistantMarketDataReader();
  const quote = (venue: string, bidUsd: number, askUsd: number) => ({
    venue,
    bidUsd,
    askUsd,
    midUsd: (bidUsd + askUsd) / 2,
    bidSize: 1,
    askSize: 1,
    markIv: 0.5,
    asOfMs: NOW - 1_000,
    bidTakerFeeUsd: null,
    askTakerFeeUsd: null,
    underlyingPriceUsd: 80_000,
  });
  const read = vi.spyOn(reader, 'executableQuotes').mockResolvedValue({
    ok: true,
    data: {
      underlying: 'BTC',
      expiry: leg.expiry,
      forwardPriceUsd: 80_000,
      indexPriceUsd: 80_000,
      quotes: [
        {
          strike: 75_000,
          right: 'put',
          venues: [quote('deribit', 1, 2), quote('thalex', 100, 120)],
        },
        { strike: 87_000, right: 'put', venues: [quote('thalex', 220, 240)] },
      ],
    },
  });
  const args = { portfolioRef: ref, underlying: 'BTC', legs: [leg] };
  const run = (input = args) => runThalexMarginPreviewTool(reader, portfolio, input, () => NOW);
  return { args, portfolio, reader, read, run, previewThalexMargin };
}

describe('Thalex margin preview', () => {
  it('uses only the scoped account and Thalex ask, and labels the result as order insertion', async () => {
    const f = fixture();
    const result = await f.run();
    expect(f.previewThalexMargin).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'account-a' }),
      {
        instrument_name: 'BTC-27NOV26-75000-P',
        price: 120,
        amount: 0.1,
      },
    );
    expect(result).toMatchObject({
      ok: true,
      data: {
        comparisonKind: 'order_insertion',
        network: 'mainnet',
        currentRequiredMarginUsd: 1_000,
        withOrderRequiredMarginUsd: 800,
        requiredMarginChangeUsd: -200,
      },
    });
    expect(JSON.stringify(result)).toContain('not a filled-position simulation');
    expect(JSON.stringify(result)).not.toContain('account-a');
  });

  it('uses the bid and with_sell for a sell candidate', async () => {
    const f = fixture();
    const result = await runThalexMarginPreviewTool(f.reader, f.portfolio, {
      ...f.args,
      legs: [{ ...leg, side: 'sell' }],
    });
    expect(f.previewThalexMargin).toHaveBeenCalledWith(expect.anything(), {
      instrument_name: 'BTC-27NOV26-75000-P',
      price: 100,
      amount: 0.1,
    });
    expect(result).toMatchObject({ ok: true, data: { requiredMarginChangeUsd: 100 } });
  });

  it('previews the complete signed ratio package instead of adding independent margin changes', async () => {
    const f = fixture();
    await runThalexMarginPreviewTool(f.reader, f.portfolio, {
      ...f.args,
      legs: [leg, { ...leg, strike: 87_000, side: 'sell', size: 0.2 }],
    });
    expect(f.previewThalexMargin).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
      legs: [
        { instrument_name: 'BTC-27NOV26-75000-P', quantity: 1 },
        { instrument_name: 'BTC-27NOV26-87000-P', quantity: -2 },
      ],
      price: -320,
      amount: 0.1,
    });
  });

  it.each([
    ['testnet', 'thalex'],
    ['mainnet', 'manual'],
  ] as const)('rejects %s/%s before reading quotes or private data', async (network, source) => {
    const f = fixture(network, source);
    expect(await f.run()).toMatchObject({ ok: false, code: 'unavailable' });
    expect(f.read).not.toHaveBeenCalled();
    expect(f.previewThalexMargin).not.toHaveBeenCalled();
  });

  it('rejects an unknown ref and a mismatched underlying before any private read', async () => {
    const f = fixture();
    expect(await f.run({ ...f.args, portfolioRef: 'pref_unknown' })).toMatchObject({
      ok: false,
      code: 'portfolio_ref_unresolved',
    });
    expect(await f.run({ ...f.args, underlying: 'ETH' })).toMatchObject({
      ok: false,
      code: 'invalid_arguments',
    });
    expect(f.previewThalexMargin).not.toHaveBeenCalled();
    expect(f.read).not.toHaveBeenCalled();
  });

  it('refuses duplicate instruments instead of previewing an invalid combination', async () => {
    const f = fixture();
    expect(await f.run({ ...f.args, legs: [leg, leg] })).toMatchObject({
      ok: false,
      code: 'invalid_arguments',
    });
    expect(f.previewThalexMargin).not.toHaveBeenCalled();
  });

  it('does not replace missing Thalex quotes with another venue', async () => {
    const f = fixture();
    f.read.mockResolvedValueOnce({
      ok: true,
      data: {
        underlying: 'BTC',
        expiry: leg.expiry,
        forwardPriceUsd: null,
        indexPriceUsd: null,
        quotes: [],
      },
    });
    expect(await f.run()).toMatchObject({ ok: false, code: 'no_quote' });
    expect(f.previewThalexMargin).not.toHaveBeenCalled();
  });

  it('redacts upstream private errors and keeps failures distinguishable from empty data', async () => {
    const f = fixture();
    f.previewThalexMargin.mockRejectedValueOnce(new Error('private-account-id secret'));
    const result = await f.run();
    expect(result).toMatchObject({ ok: false, code: 'upstream_error' });
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('reports a venue timeout without a circuit-breaker server fault', async () => {
    const f = fixture();
    f.previewThalexMargin.mockRejectedValueOnce(
      Object.assign(new Error('private'), { name: 'TimeoutError' }),
    );
    expect(await f.run()).toMatchObject({ ok: false, code: 'timeout' });
  });

  it('rejects invalid dates and nonpositive quantities at the tool boundary', () => {
    const f = fixture();
    expect(
      ThalexMarginPreviewToolInputSchema.safeParse({
        ...f.args,
        legs: [{ ...leg, expiry: '2026-02-30' }],
      }).success,
    ).toBe(false);
    expect(
      ThalexMarginPreviewToolInputSchema.safeParse({ ...f.args, legs: [{ ...leg, size: 0 }] })
        .success,
    ).toBe(false);
  });
});
