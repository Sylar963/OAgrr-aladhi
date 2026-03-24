import type { EnrichedChainResponse } from "@shared/enriched";
import { useStrategyStore } from "./strategy-store";
import type { Leg } from "./payoff";
import styles from "./Architect.module.css";

interface StrategyTemplate {
  name: string;
  icon: string;
  sentiment: "bullish" | "bearish" | "neutral" | "volatile";
  build: (chain: EnrichedChainResponse, expiry: string) => Omit<Leg, "id">[];
}

function findAtmStrike(chain: EnrichedChainResponse): number {
  const ref = chain.stats.forwardPriceUsd ?? chain.stats.spotIndexUsd ?? 70000;
  let best = chain.strikes[0]?.strike ?? ref;
  let bestDist = Infinity;
  for (const s of chain.strikes) {
    const dist = Math.abs(s.strike - ref);
    if (dist < bestDist) { bestDist = dist; best = s.strike; }
  }
  return best;
}

/** Find the best executable venue: lowest ask for buys, highest bid for sells. */
function getPrice(chain: EnrichedChainResponse, strike: number, type: "call" | "put", direction: "buy" | "sell") {
  const s = chain.strikes.find((x) => x.strike === strike);
  if (!s) return null;
  const side = type === "call" ? s.call : s.put;

  let bestPrice: number | null = null;
  let bestVenueId = "";
  let bestQ: { delta: number | null; gamma: number | null; theta: number | null; vega: number | null; markIv: number | null } | null = null;

  for (const [vid, vq] of Object.entries(side.venues)) {
    if (!vq) continue;
    const p = direction === "buy" ? vq.ask : vq.bid;
    if (p == null || p <= 0) continue;
    if (bestPrice == null
      || (direction === "buy" && p < bestPrice)
      || (direction === "sell" && p > bestPrice)
    ) {
      bestPrice = p;
      bestVenueId = vid;
      bestQ = vq;
    }
  }

  if (bestPrice == null || !bestQ) return null;
  return { price: bestPrice, venue: bestVenueId, delta: bestQ.delta, gamma: bestQ.gamma, theta: bestQ.theta, vega: bestQ.vega, iv: bestQ.markIv };
}

function findStrikeOffset(chain: EnrichedChainResponse, atm: number, offset: number): number {
  const sorted = chain.strikes.map((s) => s.strike).sort((a, b) => a - b);
  const atmIdx = sorted.indexOf(atm);
  if (atmIdx < 0) return atm;
  return sorted[Math.max(0, Math.min(sorted.length - 1, atmIdx + offset))]!;
}

function makeLeg(p: NonNullable<ReturnType<typeof getPrice>>, base: Omit<Leg, "id" | "entryPrice" | "venue" | "delta" | "gamma" | "theta" | "vega" | "iv">): Omit<Leg, "id"> {
  return { ...base, entryPrice: p.price, venue: p.venue, delta: p.delta, gamma: p.gamma, theta: p.theta, vega: p.vega, iv: p.iv };
}

const TEMPLATES: StrategyTemplate[] = [
  {
    name: "Long Call",
    icon: "📈",
    sentiment: "bullish",
    build: (chain, expiry) => {
      const atm = findAtmStrike(chain);
      const p = getPrice(chain, atm, "call", "buy");
      return p ? [makeLeg(p, { type: "call", direction: "buy", strike: atm, expiry, quantity: 1 })] : [];
    },
  },
  {
    name: "Long Put",
    icon: "📉",
    sentiment: "bearish",
    build: (chain, expiry) => {
      const atm = findAtmStrike(chain);
      const p = getPrice(chain, atm, "put", "buy");
      return p ? [makeLeg(p, { type: "put", direction: "buy", strike: atm, expiry, quantity: 1 })] : [];
    },
  },
  {
    name: "Bull Call Spread",
    icon: "↗",
    sentiment: "bullish",
    build: (chain, expiry) => {
      const atm = findAtmStrike(chain);
      const otm = findStrikeOffset(chain, atm, 3);
      const legs: Omit<Leg, "id">[] = [];
      const buy = getPrice(chain, atm, "call", "buy");
      const sell = getPrice(chain, otm, "call", "sell");
      if (buy) legs.push(makeLeg(buy, { type: "call", direction: "buy", strike: atm, expiry, quantity: 1 }));
      if (sell) legs.push(makeLeg(sell, { type: "call", direction: "sell", strike: otm, expiry, quantity: 1 }));
      return legs;
    },
  },
  {
    name: "Bear Put Spread",
    icon: "↘",
    sentiment: "bearish",
    build: (chain, expiry) => {
      const atm = findAtmStrike(chain);
      const otm = findStrikeOffset(chain, atm, -3);
      const legs: Omit<Leg, "id">[] = [];
      const buy = getPrice(chain, atm, "put", "buy");
      const sell = getPrice(chain, otm, "put", "sell");
      if (buy) legs.push(makeLeg(buy, { type: "put", direction: "buy", strike: atm, expiry, quantity: 1 }));
      if (sell) legs.push(makeLeg(sell, { type: "put", direction: "sell", strike: otm, expiry, quantity: 1 }));
      return legs;
    },
  },
  {
    name: "Long Straddle",
    icon: "⟺",
    sentiment: "volatile",
    build: (chain, expiry) => {
      const atm = findAtmStrike(chain);
      const legs: Omit<Leg, "id">[] = [];
      const call = getPrice(chain, atm, "call", "buy");
      const put = getPrice(chain, atm, "put", "buy");
      if (call) legs.push(makeLeg(call, { type: "call", direction: "buy", strike: atm, expiry, quantity: 1 }));
      if (put) legs.push(makeLeg(put, { type: "put", direction: "buy", strike: atm, expiry, quantity: 1 }));
      return legs;
    },
  },
  {
    name: "Iron Condor",
    icon: "◇",
    sentiment: "neutral",
    build: (chain, expiry) => {
      const atm = findAtmStrike(chain);
      const sp = findStrikeOffset(chain, atm, -2);
      const bp = findStrikeOffset(chain, atm, -4);
      const sc = findStrikeOffset(chain, atm, 2);
      const bc = findStrikeOffset(chain, atm, 4);
      const legs: Omit<Leg, "id">[] = [];
      const _bp = getPrice(chain, bp, "put", "buy");
      const _sp = getPrice(chain, sp, "put", "sell");
      const _sc = getPrice(chain, sc, "call", "sell");
      const _bc = getPrice(chain, bc, "call", "buy");
      if (_bp) legs.push(makeLeg(_bp, { type: "put", direction: "buy", strike: bp, expiry, quantity: 1 }));
      if (_sp) legs.push(makeLeg(_sp, { type: "put", direction: "sell", strike: sp, expiry, quantity: 1 }));
      if (_sc) legs.push(makeLeg(_sc, { type: "call", direction: "sell", strike: sc, expiry, quantity: 1 }));
      if (_bc) legs.push(makeLeg(_bc, { type: "call", direction: "buy", strike: bc, expiry, quantity: 1 }));
      return legs;
    },
  },
];

interface Props {
  chain: EnrichedChainResponse | null;
  expiry: string;
  underlying: string;
}

export default function StrategyTemplates({ chain, expiry, underlying }: Props) {
  const addLeg = useStrategyStore((s) => s.addLeg);
  const clearLegs = useStrategyStore((s) => s.clearLegs);

  if (!chain) return null;

  function handleApply(template: StrategyTemplate) {
    if (!chain) return;
    clearLegs();
    for (const leg of template.build(chain, expiry)) addLeg(leg, underlying);
  }

  return (
    <div className={styles.templateStrip}>
      {TEMPLATES.map((t) => (
        <button
          key={t.name}
          className={styles.templatePill}
          data-sentiment={t.sentiment}
          onClick={() => handleApply(t)}
          title={t.name}
        >
          <span className={styles.templatePillIcon}>{t.icon}</span>
          <span className={styles.templatePillName}>{t.name}</span>
        </button>
      ))}
    </div>
  );
}
