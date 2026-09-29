import { ConnectionStartupTimings } from './ConnectionStartupTimings';

describe('ConnectionStartupTimings', () => {
    let now: number;
    let timings: ConnectionStartupTimings;

    beforeEach(() => {
        now = 0;
        timings = new ConnectionStartupTimings(() => now);
    });

    it('separates a token acquired before the database connection', () => {
        const stopToken = timings.startTokenAcquire();
        now = 20;
        stopToken();
        const stopDatabase = timings.startDatabaseConnect();
        now = 50;
        stopDatabase();
        expect(timings.finish()).toEqual({ tokenAcquireDurationMs: 20, databaseConnectDurationMs: 30 });
    });

    it('subtracts only token waiting that overlaps database connection work', () => {
        const stopToken = timings.startTokenAcquire();
        now = 10;
        const stopDatabase = timings.startDatabaseConnect();
        now = 30;
        stopToken();
        now = 45;
        stopDatabase();
        expect(timings.finish()).toEqual({ tokenAcquireDurationMs: 30, databaseConnectDurationMs: 15 });
    });

    it('separates worker relay overhead from provider time and database work', () => {
        const stopDatabase = timings.startDatabaseConnect();
        now = 10;
        const stopWait = timings.startTokenWait();
        now = 15;
        const stopToken = timings.startTokenAcquire();
        now = 35;
        stopToken();
        now = 40;
        stopWait();
        now = 50;
        stopDatabase();
        expect(timings.finish()).toEqual({
            databaseConnectDurationMs: 20,
            tokenAcquireDurationMs: 20,
            tokenRelayDurationMs: 10,
        });
    });

    it('unions overlapping token requests and accumulates later requests', () => {
        timings.startDatabaseConnect();
        const stopFirst = timings.startTokenAcquire();
        now = 10;
        const stopSecond = timings.startTokenAcquire();
        now = 20;
        stopFirst();
        stopFirst();
        now = 30;
        stopSecond();
        now = 40;
        const stopThird = timings.startTokenAcquire();
        now = 50;
        stopThird();
        now = 60;
        expect(timings.finish()).toEqual({ databaseConnectDurationMs: 20, tokenAcquireDurationMs: 40 });
    });

    it('retains partial timings on timeout and ignores late completion', () => {
        timings.startDatabaseConnect();
        now = 10;
        const stopWait = timings.startTokenWait();
        now = 15;
        const stopToken = timings.startTokenAcquire();
        now = 50;
        const result = timings.finish();
        expect(result).toEqual({ databaseConnectDurationMs: 10, tokenRelayDurationMs: 5, tokenAcquireDurationMs: 35 });
        now = 100;
        stopToken();
        stopWait();
        timings.startTokenAcquire()();
        expect(timings.finish()).toEqual(result);
    });

    it('omits unvisited activities', () => {
        expect(timings.finish()).toEqual({});
    });
});