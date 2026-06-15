export class SystemClock {
    now() {
        return new Date();
    }
}
export class FixedClock {
    time;
    constructor(time) {
        this.time = time;
    }
    now() {
        return this.time;
    }
}
//# sourceMappingURL=clock.js.map