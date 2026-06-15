export function addUsd(a, b) {
    return round(a + b);
}
export function subUsd(a, b) {
    return round(a - b);
}
export function mulUsd(a, factor) {
    return round(a * factor);
}
function round(value) {
    return Math.round(value * 1e8) / 1e8;
}
//# sourceMappingURL=money.js.map