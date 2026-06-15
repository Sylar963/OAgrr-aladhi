export function computePositionPnl(pos, mark) {
    const unrealized = mark != null ? pos.netQuantity * (mark - pos.avgEntryPriceUsd) : null;
    return {
        key: pos.key,
        netQuantity: pos.netQuantity,
        avgEntryPriceUsd: pos.avgEntryPriceUsd,
        markPriceUsd: mark,
        unrealizedUsd: unrealized,
        realizedUsd: pos.realizedPnlUsd,
    };
}
export function computeSnapshot(positions, marks, cashUsd, now) {
    const rows = positions.map((p) => {
        const markKey = `${p.key.underlying}|${p.key.expiry}|${p.key.strike}|${p.key.optionRight}`;
        const mark = marks.get(markKey) ?? null;
        return computePositionPnl(p, mark);
    });
    const unrealized = rows.reduce((sum, r) => sum + (r.unrealizedUsd ?? 0), 0);
    const realized = rows.reduce((sum, r) => sum + r.realizedUsd, 0);
    return {
        positions: rows,
        cashUsd,
        realizedUsd: realized,
        unrealizedUsd: unrealized,
        equityUsd: cashUsd + unrealized,
        generatedAt: now,
    };
}
//# sourceMappingURL=pnl.js.map