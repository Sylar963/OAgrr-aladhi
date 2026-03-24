import { useMemo, useState } from "react";

import type { EnrichedChainResponse } from "@shared/enriched";
import type { Leg } from "./payoff";
import MiniPayoff, { STRATEGY_SHAPES } from "./MiniPayoff";
import { useStrategyStore } from "./strategy-store";
import styles from "./Architect.module.css";

type Sentiment = "bullish" | "bearish" | "volatile" | "neutral";
type Category = "all" | "directional" | "volatility" | "income";
type VariantId = "buy" | "sell";

type BuiltLeg = Omit<Leg, "id">;

interface StrategyVariant {
  id: VariantId;
  label: string;
  helper: string;
  shape: keyof typeof STRATEGY_SHAPES;
  sentiment: Sentiment;
  build: (chain: EnrichedChainResponse, expiry: string) => BuiltLeg[];
}

interface StrategyTemplate {
  id: string;
  name: string;
  category: Category;
  legs: number;
  variants: readonly [StrategyVariant, StrategyVariant];
}

function findAtmStrike(chain: EnrichedChainResponse): number {
  const ref = chain.stats.indexPriceUsd ?? chain.stats.spotIndexUsd ?? 70000;
  let best = chain.strikes[0]?.strike ?? ref;
  let bestDist = Infinity;

  for (const strike of chain.strikes) {
    const dist = Math.abs(strike.strike - ref);
    if (dist < bestDist) {
      bestDist = dist;
      best = strike.strike;
    }
  }

  return best;
}

function getBestPrice(
  chain: EnrichedChainResponse,
  strike: number,
  type: "call" | "put",
  direction: "buy" | "sell",
) {
  const strikeRow = chain.strikes.find((entry) => entry.strike === strike);
  if (!strikeRow) return null;

  const side = type === "call" ? strikeRow.call : strikeRow.put;
  let bestPrice: number | null = null;
  let bestVenueId = "";
  let bestQuote: {
    delta: number | null;
    gamma: number | null;
    theta: number | null;
    vega: number | null;
    markIv: number | null;
  } | null = null;

  for (const [venueId, quote] of Object.entries(side.venues)) {
    if (!quote) continue;
    const price = direction === "buy" ? quote.ask : quote.bid;
    if (price == null || price <= 0) continue;

    if (
      bestPrice == null
      || (direction === "buy" && price < bestPrice)
      || (direction === "sell" && price > bestPrice)
    ) {
      bestPrice = price;
      bestVenueId = venueId;
      bestQuote = quote;
    }
  }

  if (bestPrice == null || !bestQuote) return null;

  return {
    price: bestPrice,
    venue: bestVenueId,
    delta: bestQuote.delta,
    gamma: bestQuote.gamma,
    theta: bestQuote.theta,
    vega: bestQuote.vega,
    iv: bestQuote.markIv,
  };
}

function withMarket(
  price: NonNullable<ReturnType<typeof getBestPrice>>,
  base: Omit<BuiltLeg, "entryPrice" | "venue" | "delta" | "gamma" | "theta" | "vega" | "iv">,
): BuiltLeg {
  return {
    ...base,
    entryPrice: price.price,
    venue: price.venue,
    delta: price.delta,
    gamma: price.gamma,
    theta: price.theta,
    vega: price.vega,
    iv: price.iv,
  };
}

function offsetStrike(chain: EnrichedChainResponse, atm: number, offset: number): number {
  const sorted = chain.strikes.map((entry) => entry.strike).sort((a, b) => a - b);
  const idx = sorted.indexOf(atm);
  if (idx < 0) return atm;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx + offset))] ?? atm;
}

function buildCall(chain: EnrichedChainResponse, expiry: string, direction: "buy" | "sell"): BuiltLeg[] {
  const atm = findAtmStrike(chain);
  const price = getBestPrice(chain, atm, "call", direction);
  return price ? [withMarket(price, { type: "call", direction, strike: atm, expiry, quantity: 1 })] : [];
}

function buildPut(chain: EnrichedChainResponse, expiry: string, direction: "buy" | "sell"): BuiltLeg[] {
  const atm = findAtmStrike(chain);
  const price = getBestPrice(chain, atm, "put", direction);
  return price ? [withMarket(price, { type: "put", direction, strike: atm, expiry, quantity: 1 })] : [];
}

function buildCallSpread(chain: EnrichedChainResponse, expiry: string, direction: "buy" | "sell"): BuiltLeg[] {
  const atm = findAtmStrike(chain);
  const upper = offsetStrike(chain, atm, 3);
  const lowerCall = getBestPrice(chain, atm, "call", direction === "buy" ? "buy" : "sell");
  const upperCall = getBestPrice(chain, upper, "call", direction === "buy" ? "sell" : "buy");
  const legs: BuiltLeg[] = [];

  if (lowerCall) {
    legs.push(withMarket(lowerCall, {
      type: "call",
      direction: direction === "buy" ? "buy" : "sell",
      strike: atm,
      expiry,
      quantity: 1,
    }));
  }

  if (upperCall) {
    legs.push(withMarket(upperCall, {
      type: "call",
      direction: direction === "buy" ? "sell" : "buy",
      strike: upper,
      expiry,
      quantity: 1,
    }));
  }

  return legs;
}

function buildPutSpread(chain: EnrichedChainResponse, expiry: string, direction: "buy" | "sell"): BuiltLeg[] {
  const atm = findAtmStrike(chain);
  const lower = offsetStrike(chain, atm, -3);
  const atmPut = getBestPrice(chain, atm, "put", direction === "buy" ? "buy" : "sell");
  const lowerPut = getBestPrice(chain, lower, "put", direction === "buy" ? "sell" : "buy");
  const legs: BuiltLeg[] = [];

  if (atmPut) {
    legs.push(withMarket(atmPut, {
      type: "put",
      direction: direction === "buy" ? "buy" : "sell",
      strike: atm,
      expiry,
      quantity: 1,
    }));
  }

  if (lowerPut) {
    legs.push(withMarket(lowerPut, {
      type: "put",
      direction: direction === "buy" ? "sell" : "buy",
      strike: lower,
      expiry,
      quantity: 1,
    }));
  }

  return legs;
}

function buildStraddle(chain: EnrichedChainResponse, expiry: string, direction: "buy" | "sell"): BuiltLeg[] {
  const atm = findAtmStrike(chain);
  const call = getBestPrice(chain, atm, "call", direction);
  const put = getBestPrice(chain, atm, "put", direction);
  const legs: BuiltLeg[] = [];

  if (call) legs.push(withMarket(call, { type: "call", direction, strike: atm, expiry, quantity: 1 }));
  if (put) legs.push(withMarket(put, { type: "put", direction, strike: atm, expiry, quantity: 1 }));

  return legs;
}

function buildStrangle(chain: EnrichedChainResponse, expiry: string, direction: "buy" | "sell"): BuiltLeg[] {
  const atm = findAtmStrike(chain);
  const callStrike = offsetStrike(chain, atm, 3);
  const putStrike = offsetStrike(chain, atm, -3);
  const call = getBestPrice(chain, callStrike, "call", direction);
  const put = getBestPrice(chain, putStrike, "put", direction);
  const legs: BuiltLeg[] = [];

  if (call) legs.push(withMarket(call, { type: "call", direction, strike: callStrike, expiry, quantity: 1 }));
  if (put) legs.push(withMarket(put, { type: "put", direction, strike: putStrike, expiry, quantity: 1 }));

  return legs;
}

function buildIronCondor(chain: EnrichedChainResponse, expiry: string, direction: "buy" | "sell"): BuiltLeg[] {
  const atm = findAtmStrike(chain);
  const shortPutStrike = offsetStrike(chain, atm, -2);
  const longPutStrike = offsetStrike(chain, atm, -4);
  const shortCallStrike = offsetStrike(chain, atm, 2);
  const longCallStrike = offsetStrike(chain, atm, 4);

  const isShortCondor = direction === "sell";
  const legs: BuiltLeg[] = [];

  const longPut = getBestPrice(chain, longPutStrike, "put", isShortCondor ? "buy" : "sell");
  const shortPut = getBestPrice(chain, shortPutStrike, "put", isShortCondor ? "sell" : "buy");
  const shortCall = getBestPrice(chain, shortCallStrike, "call", isShortCondor ? "sell" : "buy");
  const longCall = getBestPrice(chain, longCallStrike, "call", isShortCondor ? "buy" : "sell");

  if (longPut) {
    legs.push(withMarket(longPut, {
      type: "put",
      direction: isShortCondor ? "buy" : "sell",
      strike: longPutStrike,
      expiry,
      quantity: 1,
    }));
  }

  if (shortPut) {
    legs.push(withMarket(shortPut, {
      type: "put",
      direction: isShortCondor ? "sell" : "buy",
      strike: shortPutStrike,
      expiry,
      quantity: 1,
    }));
  }

  if (shortCall) {
    legs.push(withMarket(shortCall, {
      type: "call",
      direction: isShortCondor ? "sell" : "buy",
      strike: shortCallStrike,
      expiry,
      quantity: 1,
    }));
  }

  if (longCall) {
    legs.push(withMarket(longCall, {
      type: "call",
      direction: isShortCondor ? "buy" : "sell",
      strike: longCallStrike,
      expiry,
      quantity: 1,
    }));
  }

  return legs;
}

function buildButterfly(chain: EnrichedChainResponse, expiry: string, direction: "buy" | "sell"): BuiltLeg[] {
  const atm = findAtmStrike(chain);
  const lower = offsetStrike(chain, atm, -2);
  const upper = offsetStrike(chain, atm, 2);
  const outerDirection = direction;
  const bodyDirection = direction === "buy" ? "sell" : "buy";
  const lowerCall = getBestPrice(chain, lower, "call", outerDirection);
  const bodyCall = getBestPrice(chain, atm, "call", bodyDirection);
  const upperCall = getBestPrice(chain, upper, "call", outerDirection);
  const legs: BuiltLeg[] = [];

  if (lowerCall) legs.push(withMarket(lowerCall, { type: "call", direction: outerDirection, strike: lower, expiry, quantity: 1 }));
  if (bodyCall) legs.push(withMarket(bodyCall, { type: "call", direction: bodyDirection, strike: atm, expiry, quantity: 2 }));
  if (upperCall) legs.push(withMarket(upperCall, { type: "call", direction: outerDirection, strike: upper, expiry, quantity: 1 }));

  return legs;
}

export const TEMPLATE_CARDS: StrategyTemplate[] = [
  {
    id: "call",
    name: "Call",
    category: "directional",
    legs: 1,
    variants: [
      { id: "buy", label: "Buy", helper: "Long call", shape: "Long Call", sentiment: "bullish", build: (chain, expiry) => buildCall(chain, expiry, "buy") },
      { id: "sell", label: "Sell", helper: "Short call", shape: "Short Call", sentiment: "bearish", build: (chain, expiry) => buildCall(chain, expiry, "sell") },
    ],
  },
  {
    id: "put",
    name: "Put",
    category: "directional",
    legs: 1,
    variants: [
      { id: "buy", label: "Buy", helper: "Long put", shape: "Long Put", sentiment: "bearish", build: (chain, expiry) => buildPut(chain, expiry, "buy") },
      { id: "sell", label: "Sell", helper: "Short put", shape: "Short Put", sentiment: "bullish", build: (chain, expiry) => buildPut(chain, expiry, "sell") },
    ],
  },
  {
    id: "call-spread",
    name: "Call Spread",
    category: "directional",
    legs: 2,
    variants: [
      { id: "buy", label: "Buy", helper: "Call debit spread", shape: "Call Debit Spread", sentiment: "bullish", build: (chain, expiry) => buildCallSpread(chain, expiry, "buy") },
      { id: "sell", label: "Sell", helper: "Call credit spread", shape: "Call Credit Spread", sentiment: "bearish", build: (chain, expiry) => buildCallSpread(chain, expiry, "sell") },
    ],
  },
  {
    id: "put-spread",
    name: "Put Spread",
    category: "directional",
    legs: 2,
    variants: [
      { id: "buy", label: "Buy", helper: "Put debit spread", shape: "Put Debit Spread", sentiment: "bearish", build: (chain, expiry) => buildPutSpread(chain, expiry, "buy") },
      { id: "sell", label: "Sell", helper: "Put credit spread", shape: "Put Credit Spread", sentiment: "bullish", build: (chain, expiry) => buildPutSpread(chain, expiry, "sell") },
    ],
  },
  {
    id: "straddle",
    name: "Straddle",
    category: "volatility",
    legs: 2,
    variants: [
      { id: "buy", label: "Buy", helper: "Long straddle", shape: "Long Straddle", sentiment: "volatile", build: (chain, expiry) => buildStraddle(chain, expiry, "buy") },
      { id: "sell", label: "Sell", helper: "Short straddle", shape: "Short Straddle", sentiment: "neutral", build: (chain, expiry) => buildStraddle(chain, expiry, "sell") },
    ],
  },
  {
    id: "strangle",
    name: "Strangle",
    category: "volatility",
    legs: 2,
    variants: [
      { id: "buy", label: "Buy", helper: "Long strangle", shape: "Long Strangle", sentiment: "volatile", build: (chain, expiry) => buildStrangle(chain, expiry, "buy") },
      { id: "sell", label: "Sell", helper: "Short strangle", shape: "Short Strangle", sentiment: "neutral", build: (chain, expiry) => buildStrangle(chain, expiry, "sell") },
    ],
  },
  {
    id: "iron-condor",
    name: "Iron Condor",
    category: "income",
    legs: 4,
    variants: [
      { id: "sell", label: "Sell", helper: "Credit iron condor", shape: "Iron Condor", sentiment: "neutral", build: (chain, expiry) => buildIronCondor(chain, expiry, "sell") },
      { id: "buy", label: "Buy", helper: "Reverse iron condor", shape: "Reverse Iron Condor", sentiment: "volatile", build: (chain, expiry) => buildIronCondor(chain, expiry, "buy") },
    ],
  },
  {
    id: "butterfly",
    name: "Butterfly",
    category: "income",
    legs: 3,
    variants: [
      { id: "buy", label: "Buy", helper: "Long butterfly", shape: "Butterfly", sentiment: "neutral", build: (chain, expiry) => buildButterfly(chain, expiry, "buy") },
      { id: "sell", label: "Sell", helper: "Short butterfly", shape: "Short Butterfly", sentiment: "volatile", build: (chain, expiry) => buildButterfly(chain, expiry, "sell") },
    ],
  },
];

const CATEGORIES: Array<{ id: Category; label: string }> = [
  { id: "all", label: "All" },
  { id: "directional", label: "Directional" },
  { id: "volatility", label: "Volatility" },
  { id: "income", label: "Income" },
];

const DEFAULT_VARIANTS: Record<string, VariantId> = {
  call: "buy",
  put: "buy",
  "call-spread": "buy",
  "put-spread": "buy",
  straddle: "buy",
  strangle: "buy",
  "iron-condor": "sell",
  butterfly: "buy",
};

function makeDragId(templateId: string, variantId: VariantId): string {
  return `${templateId}:${variantId}`;
}

export function findTemplateVariant(dragId: string) {
  const [templateId, variantId] = dragId.split(":") as [string | undefined, VariantId | undefined];
  if (!templateId || !variantId) return null;

  const template = TEMPLATE_CARDS.find((entry) => entry.id === templateId);
  if (!template) return null;

  const variant = template.variants.find((entry) => entry.id === variantId);
  if (!variant) return null;

  return { template, variant };
}

interface Props {
  chain: EnrichedChainResponse | null;
  expiry: string;
  underlying: string;
}

export default function StrategyTemplates({ chain, expiry, underlying }: Props) {
  const addLeg = useStrategyStore((state) => state.addLeg);
  const clearLegs = useStrategyStore((state) => state.clearLegs);
  const [category, setCategory] = useState<Category>("all");
  const [error, setError] = useState<string | null>(null);
  const [selectedVariants, setSelectedVariants] = useState<Record<string, VariantId>>(DEFAULT_VARIANTS);

  const filtered = useMemo(
    () => category === "all" ? TEMPLATE_CARDS : TEMPLATE_CARDS.filter((template) => template.category === category),
    [category],
  );

  if (!chain) return null;
  const chainData = chain;

  function applyVariant(template: StrategyTemplate, variant: StrategyVariant) {
    setError(null);
    const newLegs = variant.build(chainData, expiry);
    if (newLegs.length === 0) {
      setError(`No quotes for ${variant.helper}. Try a later expiry.`);
      return;
    }
    if (newLegs.length < template.legs) {
      setError(`${variant.helper} needs ${template.legs} legs but only ${newLegs.length} had quotes — try a later expiry.`);
      return;
    }

    clearLegs();
    for (const leg of newLegs) addLeg(leg, underlying);
  }

  return (
    <div className={styles.templatesSection}>
      <div className={styles.sentimentBar}>
        {CATEGORIES.map((entry) => (
          <button
            key={entry.id}
            className={styles.sentimentBtn}
            data-active={entry.id === category}
            onClick={() => setCategory(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className={styles.templateGrid}>
        {filtered.map((template) => {
          const selectedVariantId = selectedVariants[template.id] ?? template.variants[0].id;
          const selectedVariant = template.variants.find((entry) => entry.id === selectedVariantId) ?? template.variants[0];
          const dragId = makeDragId(template.id, selectedVariant.id);

          return (
            <div
              key={template.id}
              className={styles.templateCard}
              data-sentiment={selectedVariant.sentiment}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData("text/plain", dragId);
                event.dataTransfer.effectAllowed = "copy";
              }}
            >
              <MiniPayoff shape={STRATEGY_SHAPES[selectedVariant.shape] ?? [[0, 0], [1, 0]]} width={120} height={48} />

              <div className={styles.templateCardInfo}>
                <span className={styles.templateCardName}>{template.name}</span>
                <span className={styles.templateCardHelper}>{selectedVariant.helper}</span>
                <span className={styles.templateCardMeta}>{template.legs} leg{template.legs !== 1 ? "s" : ""}</span>
              </div>

              <div className={styles.templateVariantSwitch}>
                {template.variants.map((variant) => (
                  <button
                    key={variant.id}
                    className={styles.templateVariantBtn}
                    data-active={variant.id === selectedVariant.id}
                    onClick={() => {
                      setSelectedVariants((prev) => ({ ...prev, [template.id]: variant.id }));
                      applyVariant(template, variant);
                    }}
                  >
                    {variant.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {error && (
        <div className={styles.templateError}>
          {error}
          <button className={styles.templateErrorClose} onClick={() => setError(null)}>✕</button>
        </div>
      )}
    </div>
  );
}
