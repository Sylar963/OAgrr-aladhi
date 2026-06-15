export function newOrderId() {
    return `ord_${cryptoRandom()}`;
}
export function newClientOrderId() {
    return `cid_${cryptoRandom()}`;
}
function cryptoRandom() {
    const bytes = new Uint8Array(12);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
//# sourceMappingURL=order.js.map