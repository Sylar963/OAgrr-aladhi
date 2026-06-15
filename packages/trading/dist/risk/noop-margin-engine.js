// Default mode: no margin check. Equivalent to today's behavior. Used when
// PAPER_MARGIN_MODE is unset or set to 'noop'. Keeps the gate optional until
// per-venue portfolio-margin formulas are documented and implemented.
export class NoopMarginEngine {
    async estimate(input) {
        return {
            ok: true,
            requiredUsd: 0,
            availableUsd: input.equityUsd,
            bufferUsd: 0,
            reason: null,
            perLeg: input.prospectiveLegs.map((l) => ({
                legIndex: l.index,
                requiredUsd: 0,
                reason: 'noop',
            })),
        };
    }
}
//# sourceMappingURL=noop-margin-engine.js.map