export interface ConnectionCostMeasurements {
    tokenAcquireDurationMs?: number;
    databaseConnectDurationMs?: number;
    tokenRelayDurationMs?: number;
}

type TimingActivity = 'database' | 'tokenAcquire' | 'tokenWait';

export class ConnectionStartupTimings {
    private readonly active: Record<TimingActivity, number> = { database: 0, tokenAcquire: 0, tokenWait: 0 };
    private readonly measurements: ConnectionCostMeasurements = {};
    private lastUpdatedAt: number;
    private finished = false;

    constructor(private readonly now: () => number = () => performance.now()) {
        this.lastUpdatedAt = now();
    }

    startDatabaseConnect(): () => void {
        return this.start('database');
    }

    startTokenAcquire(): () => void {
        return this.start('tokenAcquire');
    }

    startTokenWait(): () => void {
        return this.start('tokenWait');
    }

    finish(): ConnectionCostMeasurements {
        this.update();
        this.finished = true;
        return { ...this.measurements };
    }

    private start(activity: TimingActivity): () => void {
        if (this.finished) {
            return (): void => undefined;
        }

        this.update();
        this.active[activity]++;
        if (activity === 'database') {
            this.measurements.databaseConnectDurationMs ??= 0;
        } else if (activity === 'tokenAcquire') {
            this.measurements.tokenAcquireDurationMs ??= 0;
        } else {
            this.measurements.tokenRelayDurationMs ??= 0;
        }

        let stopped = false;
        return (): void => {
            if (stopped || this.finished) {
                return;
            }
            this.update();
            this.active[activity]--;
            stopped = true;
        };
    }

    private update(): void {
        if (this.finished) {
            return;
        }

        const now = this.now();
        const elapsed = Math.max(0, now - this.lastUpdatedAt);
        this.lastUpdatedAt = now;
        if (this.active.tokenAcquire > 0) {
            this.measurements.tokenAcquireDurationMs = (this.measurements.tokenAcquireDurationMs ?? 0) + elapsed;
        }
        if (this.active.database > 0 && this.active.tokenAcquire === 0 && this.active.tokenWait === 0) {
            this.measurements.databaseConnectDurationMs = (this.measurements.databaseConnectDurationMs ?? 0) + elapsed;
        }
        if (this.active.tokenWait > 0 && this.active.tokenAcquire === 0) {
            this.measurements.tokenRelayDurationMs = (this.measurements.tokenRelayDurationMs ?? 0) + elapsed;
        }
    }
}

export async function withTokenAcquisitionTiming<T>(
    timings: ConnectionStartupTimings | undefined,
    operation: () => Promise<T>,
): Promise<T> {
    const stop = timings?.startTokenAcquire();
    try {
        return await operation();
    } finally {
        stop?.();
    }
}