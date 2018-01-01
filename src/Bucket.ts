import Timer = NodeJS.Timer;

export default class Bucket {
    /**
     * How many calls the bucket can consume in the current interval
     *
     * @type {number}
     */
    public limit: number;

    /**
     * How many calls the bucket has left in the current interval
     *
     * @type {number}
     */
    public remaining: number;

    /**
     * Timestamp of the next reset
     *
     * * @type {number}
     */
    public reset: number = 0;

    /**
     * Whether the queue is being processed
     *
     * @type {boolean}
     */
    private processing: Timer | boolean;

    /**
     * Inverval between consuming tokens
     *
     * @type {number}
     */
    private latency: number;

    /**
     * calls in the bucket.
     *
     * @type {Function[]}
     */
    private calls: Function[] = [];

    private resetInterval: number = 0;

    constructor(limit: number = 1, latency: number = 0) {
        this.remaining = limit;
        this.latency = latency;
    }

    /**
     * Add a call
     * @param {Function} action
     * @param {boolean} immediate
     */
    public queue(action: Function, immediate: boolean = false): void {
        this.calls[immediate ? "unshift" : "push"](action);
        this.check();
    }

    private check(ignoreProcessing: boolean = false): void {
        if (this.calls.length === 0) {
            if (this.processing) {
                clearTimeout(this.processing as Timer);
                this.processing = undefined;
            }

            return;
        }
        if (this.processing && !ignoreProcessing) {
            return;
        }

        const now = Date.now();
        if (!this.reset) {
            this.reset = now - this.latency;
            this.remaining = this.limit;
        } else if (this.reset < now - this.latency) {
            this.reset = now - this.latency + (this.resetInterval || 0);
            this.remaining = this.limit;
        }
        if (this.remaining <= 0) {
            this.processing = setTimeout(() => {
                this.processing = undefined;
                this.check(true);
            }, Math.max(0, (this.reset || 0) - now) + this.latency);

            return;
        }

        --this.remaining;
        this.processing = setTimeout(() => this.calls.length > 0 ? this.check(true) : this.processing = undefined, 0);
    }
}
