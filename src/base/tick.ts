export class TickLoop {
    public static readonly TICK_MS = 50;
    private static readonly TICK_NS = BigInt(this.TICK_MS) * 1_000_000n;
    public static readonly MAX_CATCHUP_TICKS = 10;

    private running: boolean;
    private nextTickTime: bigint;
    private timer: any = null;

    constructor(
        private onTick: () => any,
    ) {
        this.running = false;
        this.nextTickTime = BigInt(0);
    }

    public start() {
        this.running = true;
        this.nextTickTime = process.hrtime.bigint();
        this.next();
    }

    public stop() {
        this.running = false;
        clearInterval(this.timer);
        this.nextTickTime = BigInt(0);
    }

    private next() {
        if (!this.running) this.stop();

        const now = process.hrtime.bigint();
        let tickRuns = 0;
        while (this.nextTickTime < now && tickRuns < TickLoop.MAX_CATCHUP_TICKS) {
            this.onTick();
            this.nextTickTime += TickLoop.TICK_NS;
            tickRuns++;
        }

        if (tickRuns >= TickLoop.MAX_CATCHUP_TICKS)
            this.nextTickTime = now + TickLoop.TICK_NS;

        const delayMs = Number((this.nextTickTime - process.hrtime.bigint())) / 1_000_000;
        this.timer = setTimeout(() => this.next(), Math.max(0, delayMs));
    }
}