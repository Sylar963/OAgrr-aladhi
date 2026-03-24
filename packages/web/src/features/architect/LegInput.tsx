import { useState } from "react";

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

  // Sync expiry when global changes or data loads
  if (!expiry && expiries.length > 0) {
    setExpiry(expiries.length > 1 ? expiries[1]! : expiries[0]!);
  }

  const { data: chain } = useChainQuery(underlying, expiry, activeVenues);
  const strikes = chain?.strikes.map((s) => s.strike) ?? [];

  // Find the closest available strike to what user typed
  const typedStrike = Number(strikeInput) || 0;
  const resolvedStrike = strikes.length > 0
    ? strikes.reduce((best, s) => Math.abs(s - typedStrike) < Math.abs(best - typedStrike) ? s : best)
    : typedStrike;

  function handleAdd() {
    if (!chain || !expiry) return;
    const strike = resolvedStrike || strikes[Math.floor(strikes.length / 2)] || 70000;
    const s = chain.strikes.find((x) => x.strike === strike);
    const side = type === "call" ? s?.call : s?.put;
    const bestVenue = side?.bestVenue ?? "deribit";
    const q = bestVenue ? side?.venues[bestVenue] : null;
    const price = direction === "buy" ? (q?.ask ?? 0) : (q?.bid ?? 0);

    addLeg({
      type,
      direction,
      strike,
      expiry,
      quantity: Math.max(1, parseInt(qty, 10) || 1),
      entryPrice: price,
      venue: bestVenue,
      delta: q?.delta ?? null,
      gamma: q?.gamma ?? null,
      theta: q?.theta ?? null,
      vega: q?.vega ?? null,
      iv: q?.markIv ?? null,
    });

    setStrikeInput("");
  }

  return (
    <div className={styles.legInput}>
      <div className={styles.legInputRow}>
        <div className={styles.legInputToggle}>
          <button
            className={styles.toggleBtn}
            data-active={direction === "buy"}
            data-type="buy"
            onClick={() => setDirection("buy")}
          >
            BUY
          </button>
          <button
            className={styles.toggleBtn}
            data-active={direction === "sell"}
            data-type="sell"
            onClick={() => setDirection("sell")}
          >
            SELL
          </button>
        </div>

        <input
          type="number"
          className={styles.legInputField}
          placeholder="Qty"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          min={1}
          style={{ width: 50 }}
        />

        <input
          type="number"
          className={styles.legInputField}
          placeholder="Strike"
          value={strikeInput}
          onChange={(e) => setStrikeInput(e.target.value)}
          style={{ width: 90 }}
        />

        <div className={styles.legInputToggle}>
          <button
            className={styles.toggleBtn}
            data-active={type === "call"}
            data-type="call"
            onClick={() => setType("call")}
          >
            CALL
          </button>
          <button
            className={styles.toggleBtn}
            data-active={type === "put"}
            data-type="put"
            onClick={() => setType("put")}
          >
            PUT
          </button>
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
