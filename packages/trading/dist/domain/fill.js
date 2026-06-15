export function newFillId() {
    const bytes = new Uint8Array(12);
    globalThis.crypto.getRandomValues(bytes);
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `fil_${hex}`;
}
export function fillCashDelta(fill) {
    const sign = fill.side === 'buy' ? -1 : 1;
    const premium = sign * fill.priceUsd * fill.quantity;
    return premium - fill.feesUsd;
}
//# sourceMappingURL=fill.js.map