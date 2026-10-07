import type { PersistedExchangeTrade } from "@oggregator/db";
import { describe, expect, it, vi } from "vitest";

vi.mock("./portfolio-services.js", () => ({
  bootstrapPortfolioForAccount: vi.fn(),
  getOrCreatePortfolioRuntime: vi.fn(),
}));

const { buildTradeHistoryFacts, summarizeTradeFacts } =
  await import("./portfolio-assistant-context-builder.js");

function trade(
  overrides: Partial<PersistedExchangeTrade>,
): PersistedExchangeTrade {
  return {
    tradeId: "t1",
    orderId: "o1",
    groupId: null,
    instrumentName: "BTC-10OCT26-60000-C",
    underlying: "BTC",
    expiry: "2026-10-10",
    strike: 60_000,
    optionRight: "call",
    direction: "buy",
    amount: 0.5,
    priceUsd: 1_234.567,
    feeUsd: 1.234,
    realizedPnlUsd: null,
    liquidityRole: "taker",
    timestampMs: Date.UTC(2026, 8, 20),
    ...overrides,
  };
}

describe("buildTradeHistoryFacts", () => {
  it("filters by underlying, sorts newest first and computes premium", () => {
    const facts = buildTradeHistoryFacts(
      "thalex",
      [
        trade({ tradeId: "old", timestampMs: Date.UTC(2026, 8, 15) }),
        trade({
          tradeId: "eth",
          underlying: "ETH",
          instrumentName: "ETH-10OCT26-3000-P",
        }),
        trade({
          tradeId: "new",
          direction: "sell",
          timestampMs: Date.UTC(2026, 8, 28),
          realizedPnlUsd: -12.346,
        }),
      ],
      "BTC",
      10,
    );
    expect(facts.trades.map((t) => t.tradedAt)).toEqual([
      "2026-09-28T00:00:00.000Z",
      "2026-09-15T00:00:00.000Z",
    ]);
    expect(facts.trades[0]).toMatchObject({
      side: "sell",
      priceUsd: 1_234.57,
      premiumUsd: 617.28,
      feeUsd: 1.23,
      realizedPnlUsd: -12.35,
    });
    expect(facts.trades[1]?.realizedPnlUsd).toBeNull();
    expect(facts.truncated).toBe(false);
  });

  it("flags truncation when more trades exist than the limit", () => {
    const trades = [1, 2, 3].map((day) =>
      trade({ tradeId: `t${day}`, timestampMs: Date.UTC(2026, 8, day) }),
    );
    const facts = buildTradeHistoryFacts("thalex", trades, null, 2);
    expect(facts.trades).toHaveLength(2);
    expect(facts.truncated).toBe(true);
  });

  it("adds null-aware totals over the listed fills only", () => {
    const fills = [
      trade({ tradeId: "a", instrumentName: "BTC-30OCT26-85000-C", direction: "sell", amount: 0.5, priceUsd: 3_020, feeUsd: 6.29, realizedPnlUsd: null, timestampMs: Date.UTC(2026, 9, 6, 12) }),
      trade({ tradeId: "b", instrumentName: "BTC-30OCT26-85000-C", direction: "sell", amount: 0.5, priceUsd: 3_043.9, feeUsd: 12.58, realizedPnlUsd: null, timestampMs: Date.UTC(2026, 9, 6, 11) }),
      trade({ tradeId: "c", instrumentName: "BTC-16OCT26-80000-P", direction: "buy", amount: 1, priceUsd: 410, feeUsd: null, realizedPnlUsd: 230, timestampMs: Date.UTC(2026, 9, 3) }),
      trade({ tradeId: "d", instrumentName: "BTC-16OCT26-80000-P", direction: "sell", amount: 1, priceUsd: 640, feeUsd: 25.17, realizedPnlUsd: null, timestampMs: Date.UTC(2026, 9, 2) }),
      trade({ tradeId: "e", instrumentName: "BTC-09OCT26-90000-C", direction: "sell", amount: 0.3, priceUsd: 520, feeUsd: 7.55, realizedPnlUsd: -114, timestampMs: Date.UTC(2026, 9, 1) }),
      trade({ tradeId: "old", instrumentName: "BTC-09OCT26-90000-C", direction: "buy", amount: 0.3, priceUsd: 900, feeUsd: 7.55, timestampMs: Date.UTC(2026, 8, 1) }),
    ];
    const facts = buildTradeHistoryFacts("thalex", fills, "BTC", 5);

    expect(facts.truncated).toBe(true);
    expect(facts.totals).toMatchObject({
      fillCount: 5,
      firstFillAt: "2026-10-01T00:00:00.000Z",
      lastFillAt: "2026-10-06T12:00:00.000Z",
      feesUsd: 51.59,
      fillsWithoutFee: 1,
      premiumBoughtUsd: 410,
      premiumSoldUsd: 3_827.95,
      netPremiumPaidUsd: -3_417.95,
      realizedPnlUsd: 116,
      fillsWithRealizedPnl: 2,
      fillsWithoutRealizedPnl: 3,
      recentFees: [],
      instrumentsOmitted: 0,
    });
    expect(facts.totals.scope).toContain("not lifetime");
    expect(facts.totals.byInstrument[1]).toEqual({
      instrument: "BTC-16OCT26-80000-P",
      fills: 2,
      netAmount: 0,
      feesUsd: 25.17,
      premiumBoughtUsd: 410,
      premiumSoldUsd: 640,
      realizedPnlUsd: 230,
      fillsWithoutRealizedPnl: 1,
    });
    expect(facts.totals.byInstrument[0]).toMatchObject({
      instrument: "BTC-30OCT26-85000-C",
      netAmount: -1,
      realizedPnlUsd: null,
      fillsWithoutRealizedPnl: 2,
    });
  });

  it("sums the newest N fills for recent-fee questions and caps the instrument breakdown", () => {
    const fills = Array.from({ length: 24 }, (_, index) =>
      trade({
        tradeId: `t${index}`,
        instrumentName: `BTC-30OCT26-${80_000 + index * 1_000}-C`,
        feeUsd: index + 1,
        timestampMs: Date.UTC(2026, 9, 1) - index * 60_000,
      }),
    );
    const totals = buildTradeHistoryFacts("derive", fills, "BTC", 100).totals;
    expect(totals.recentFees).toEqual([
      { fills: 5, feesUsd: 15, fillsWithoutFee: 0 },
      { fills: 10, feesUsd: 55, fillsWithoutFee: 0 },
      { fills: 20, feesUsd: 210, fillsWithoutFee: 0 },
    ]);
    expect(totals.feesUsd).toBe(300);
    expect(totals.realizedPnlUsd).toBeNull();
    expect(totals.byInstrument).toHaveLength(10);
    expect(totals.instrumentsOmitted).toBe(14);

    const compact = buildTradeHistoryFacts("derive", fills, "BTC", 100);
    expect(summarizeTradeFacts(compact.trades.slice(0, 5)).feesUsd).toBe(15);
  });
});
