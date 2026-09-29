import type { PersistedExchangeTrade } from "@oggregator/db";
import { describe, expect, it, vi } from "vitest";

vi.mock("./portfolio-services.js", () => ({
  bootstrapPortfolioForAccount: vi.fn(),
  getOrCreatePortfolioRuntime: vi.fn(),
}));

const { buildTradeHistoryFacts } =
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
});
