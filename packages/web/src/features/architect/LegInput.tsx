import { useState, useRef, useEffect } from "react";

import { useAppStore } from "@stores/app-store";
import { useChainQuery, useExpiries } from "@features/chain/queries";
import { DropdownPicker } from "@components/ui";
import { formatExpiry, dteDays } from "@lib/format";
import { useStrategyStore } from "./strategy-store";
import styles from "./Architect.module.css";

export default function LegInput() {
  const underlying   = useAppStore((s) => s.underlying);
  const activeVenues = useAppStore((s) => s.activeVenues);
  const globalExpiry = useAppStore((s) => s.expiry);
  const { data: expiriesData } = useExpiries(underlying);
  const expiries = expiriesData?.expiries ?? [];
  const addLeg = useStrategyStore((s) => s.addLeg);

  const [expiry, setExpiry] = useState(globalExpiry || expiries[1] || expiries[0] || "");
  const [type, setType] = useState<"call" | "put">("call");
  const [direction, setDirection] = useState<"buy" | "sell">("buy");
  const [strikeInput, setStrikeInput] = useState("");
  const [qty, setQty] = useState("1");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const strikeRef = useRef<HTMLDivElement>(null);

  if (!expiry && expiries.length > 0) {
    setExpiry(expiries.length > 1 ? expiries[1]! : expiries[0]!);
  }

  const { data: chain } = useChainQuery(underlying, expiry, activeVenues);
  const strikes = chain?.strikes.map((s) => s.strike) ?? [];
  const atmStrike = chain?.stats.atmStrike ?? 0;

  // Filter strikes by input
  const filtered = strikeInput
    ? strikes.filter((s) => s.toString().includes(strikeInput))
    : strikes;

  // Close suggestions on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (strikeRef.current && !strikeRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function handleSelectStrike(strike: number) {
    setStrikeInput(strike.toString());
    setShowSuggestions(false);
  }

  function handleAdd() {
    if (!chain || !expiry) return;
    const targetStrike = Number(strikeInput) || atmStrike;
    const strike = strikes.reduce((best, s) =>
      Math.abs(s - targetStrike) < Math.abs(best - targetStrike) ? s : best,
      strikes[0] ?? targetStrike,
    );
    const s = chain.strikes.find((x) => x.strike === strike);
    const side = type === "call" ? s?.call : s?.put;

    // Find best executable venue: lowest ask for buys, highest bid for sells
    let bestPrice: number | null = null;
    let bestVenueId = "";
    let bestQ: { delta: number | null; gamma: number | null; theta: number | null; vega: number | null; markIv: number | null } | null = null;

    if (side) {
      for (const [vid, vq] of Object.entries(side.venues)) {
        if (!vq || !activeVenues.includes(vid)) continue;
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
    }

    if (bestPrice == null || bestPrice <= 0) return;

    addLeg({
      type,
      direction,
      strike,
      expiry,
      quantity: Math.max(1, parseInt(qty, 10) || 1),
      entryPrice: bestPrice,
      venue: bestVenueId,
      delta: bestQ?.delta ?? null,
      gamma: bestQ?.gamma ?? null,
      theta: bestQ?.theta ?? null,
      vega: bestQ?.vega ?? null,
      iv: bestQ?.markIv ?? null,
    }, underlying);

    setStrikeInput("");
  }

  return (
    <div className={styles.legInput}>
      <div className={styles.legInputRow}>
        <div className={styles.legInputToggle}>
          <button className={styles.toggleBtn} data-active={direction === "buy"} data-type="buy" onClick={() => setDirection("buy")}>BUY</button>
          <button className={styles.toggleBtn} data-active={direction === "sell"} data-type="sell" onClick={() => setDirection("sell")}>SELL</button>
        </div>

        <input
          type="text"
          inputMode="numeric"
          className={styles.legInputField}
          placeholder="Qty"
          value={qty}
          onChange={(e) => setQty(e.target.value.replace(/\D/g, ""))}
          style={{ width: 42 }}
        />

        <div className={styles.strikeInputWrap} ref={strikeRef}>
          <input
            type="text"
            inputMode="numeric"
            className={styles.legInputField}
            placeholder={atmStrike ? atmStrike.toLocaleString() : "Strike"}
            value={strikeInput}
            onChange={(e) => { setStrikeInput(e.target.value.replace(/\D/g, "")); setShowSuggestions(true); }}
            onFocus={() => setShowSuggestions(true)}
            style={{ width: 90 }}
          />
          {showSuggestions && filtered.length > 0 && (
            <div className={styles.strikeSuggestions}>
              {filtered.slice(0, 20).map((s) => (
                <button
                  key={s}
                  className={styles.strikeSuggestion}
                  data-atm={s === atmStrike || undefined}
                  onClick={() => handleSelectStrike(s)}
                >
                  {s.toLocaleString()}
                  {s === atmStrike && <span className={styles.strikeSuggestionMeta}>ATM</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className={styles.legInputToggle}>
          <button className={styles.toggleBtn} data-active={type === "call"} data-type="call" onClick={() => setType("call")}>CALL</button>
          <button className={styles.toggleBtn} data-active={type === "put"} data-type="put" onClick={() => setType("put")}>PUT</button>
        </div>

        <DropdownPicker
          size="sm"
          value={expiry}
          onChange={setExpiry}
          options={expiries.map((e) => ({ value: e, label: formatExpiry(e), meta: `${dteDays(e)}d` }))}
        />

        <button className={styles.addLegBtn} onClick={handleAdd}>+ Add</button>
      </div>
    </div>
  );
}
