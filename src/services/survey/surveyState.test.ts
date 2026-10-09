/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LEGACY_SURVEY_STATE_KEYS, SURVEY_STATE_KEY } from './surveyConfig';
import {
    EMPTY_SURVEY_STATE,
    mergeSurveyStates,
    parseSurveyState,
    SurveyStateStore,
    type SurveyStateStorage,
} from './surveyState';
import { type SurveyPersistedState } from './surveyTypes';

const NOW = new Date('2026-10-07T12:34:56.789Z');
const NEXT_ELIGIBLE_AT = new Date('2026-10-21T12:34:56.789Z');

class MemorySurveyStorage implements SurveyStateStorage {
    public readonly values = new Map<string, unknown>();
    public readonly getCalls: string[] = [];
    public readonly update = jest.fn<Promise<void>, [string, unknown]>(
        async (key, value): Promise<void> => this.write(key, value),
    );

    public get<T>(key: string): T | undefined {
        this.getCalls.push(key);
        return this.values.get(key) as T | undefined;
    }

    public write(key: string, value: unknown): void {
        if (value === undefined) {
            this.values.delete(key);
        } else {
            this.values.set(key, JSON.parse(JSON.stringify(value)) as unknown);
        }
    }
}

interface Deferred {
    readonly promise: Promise<void>;
    readonly resolve: () => void;
    readonly reject: (error: unknown) => void;
}

function createDeferred(): Deferred {
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<void>((resolvePromise, rejectPromise): void => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function seedLegacyState(storage: MemorySurveyStorage): void {
    const values: readonly unknown[] = [999, '2026-10-07', '999.0.0', NOW.toISOString(), NOW.toISOString()];
    LEGACY_SURVEY_STATE_KEYS.forEach((key, index): void => {
        storage.values.set(key, values[index]);
    });
}

function legacyDeletionCalls(storage: MemorySurveyStorage): [string, unknown][] {
    return storage.update.mock.calls.filter(([key]): boolean => LEGACY_SURVEY_STATE_KEYS.includes(key));
}

describe('mergeSurveyStates', (): void => {
    it.each([false, true])(
        'never shortens a cooldown with outcome transitions, reverse=%s',
        async (reverse): Promise<void> => {
            const storage = new MemorySurveyStorage();
            const store = new SurveyStateStore(storage);
            const later = new Date('2027-04-05T12:34:56.789Z');
            if (reverse) {
                await store.recordOutcome('opened', later);
                await store.recordOutcome('askLater', NEXT_ELIGIBLE_AT);
            } else {
                await store.recordOutcome('askLater', NEXT_ELIGIBLE_AT);
                await store.recordOutcome('opened', later);
            }
            expect(store.current.nextEligibleAt).toBe(later.toISOString());
            expect(store.current.lastOutcome).toBe('opened');
            await store.recordOptOut(NOW);
            await store.recordCooldown(NEXT_ELIGIBLE_AT);
            expect(store.isOptedOut).toBe(true);
            expect(store.current.nextEligibleAt).toBe(later.toISOString());
        },
    );

    function expectBothOrders(a: SurveyPersistedState, b: SurveyPersistedState, expected: SurveyPersistedState): void {
        expect(mergeSurveyStates(a, b)).toEqual(expected);
        expect(mergeSurveyStates(b, a)).toEqual(expected);
    }

    it('keeps opt-out sticky and selects the earlier valid timestamp in both orders', (): void => {
        const earlier = { ...EMPTY_SURVEY_STATE, optedOutAt: NOW.toISOString() };
        const later = { ...EMPTY_SURVEY_STATE, optedOutAt: NEXT_ELIGIBLE_AT.toISOString() };
        const malformed = { ...EMPTY_SURVEY_STATE, optedOutAt: 'invalid' };
        expectBothOrders(earlier, EMPTY_SURVEY_STATE, earlier);
        expectBothOrders(earlier, later, earlier);
        expectBothOrders(earlier, malformed, earlier);
        expectBothOrders(malformed, EMPTY_SURVEY_STATE, malformed);
    });

    it('merges the maximum count and latest active day independently in both orders', (): void => {
        const a = { ...EMPTY_SURVEY_STATE, activeDayCount: 7, lastActiveDay: '2026-10-01' };
        const b = { ...EMPTY_SURVEY_STATE, activeDayCount: 2, lastActiveDay: '2026-10-07' };
        expectBothOrders(a, b, { ...a, lastActiveDay: b.lastActiveDay });
        expectBothOrders(b, EMPTY_SURVEY_STATE, b);
    });

    it('takes the later parsed cooldown and its outcome together in both orders', (): void => {
        const a: SurveyPersistedState = {
            ...EMPTY_SURVEY_STATE,
            lastOutcome: 'askLater',
            nextEligibleAt: '2026-10-21T14:34:56.789+02:00',
        };
        const b: SurveyPersistedState = {
            ...EMPTY_SURVEY_STATE,
            lastOutcome: 'opened',
            nextEligibleAt: '2026-10-21T12:35:56.789Z',
        };
        expectBothOrders(a, b, b);
        expectBothOrders(a, { ...b, lastOutcome: undefined }, { ...b, lastOutcome: undefined });
    });

    it('ranks missing and unparseable cooldowns below valid dates in both orders', (): void => {
        const valid: SurveyPersistedState = {
            ...EMPTY_SURVEY_STATE,
            lastOutcome: 'opened',
            nextEligibleAt: NEXT_ELIGIBLE_AT.toISOString(),
        };
        expectBothOrders(valid, { ...EMPTY_SURVEY_STATE, lastOutcome: 'askLater' }, valid);
        expectBothOrders(valid, { ...EMPTY_SURVEY_STATE, lastOutcome: 'askLater', nextEligibleAt: 'invalid' }, valid);
    });

    it('keeps the first cooldown pair on a tie, falling back only for a missing outcome', (): void => {
        const a: SurveyPersistedState = {
            ...EMPTY_SURVEY_STATE,
            lastOutcome: 'opened',
            nextEligibleAt: NEXT_ELIGIBLE_AT.toISOString(),
        };
        const b: SurveyPersistedState = {
            ...EMPTY_SURVEY_STATE,
            lastOutcome: 'askLater',
            nextEligibleAt: '2026-10-21T14:34:56.789+02:00',
        };
        expect(mergeSurveyStates(a, b)).toEqual(a);
        expect(mergeSurveyStates(b, a)).toEqual(b);
        expect(mergeSurveyStates({ ...a, lastOutcome: undefined }, b)).toEqual({ ...a, lastOutcome: 'askLater' });
        expect(mergeSurveyStates({ ...b, lastOutcome: undefined }, a)).toEqual({ ...b, lastOutcome: 'opened' });
    });
});

describe('SurveyStateStore', (): void => {
    it('starts empty without reading legacy values or writing on construction', (): void => {
        const storage = new MemorySurveyStorage();
        const store = new SurveyStateStore(storage);

        expect(storage.getCalls).toEqual([SURVEY_STATE_KEY]);
        expect(store.current).toEqual(EMPTY_SURVEY_STATE);
        expect(store.current).not.toBe(EMPTY_SURVEY_STATE);
        expect(store.isOptedOut).toBe(false);
        expect(store.hasUnsavedChanges).toBe(false);
        expect(storage.getCalls).toEqual(Array<string>(4).fill(SURVEY_STATE_KEY));
        expect(storage.update).not.toHaveBeenCalled();
    });

    it('starts empty when the state read throws', (): void => {
        const storage = new MemorySurveyStorage();
        const get = jest.spyOn(storage, 'get').mockImplementation((): never => {
            throw new Error('Read failed');
        });

        const store = new SurveyStateStore(storage);

        expect(store.current).toEqual(EMPTY_SURVEY_STATE);
        expect(store.isOptedOut).toBe(false);
        expect(store.hasUnsavedChanges).toBe(false);
        expect(get).toHaveBeenCalledTimes(3);
        expect(get).toHaveBeenCalledWith(SURVEY_STATE_KEY);
        expect(storage.update).not.toHaveBeenCalled();
    });

    it('counts three distinct active days and never writes for the same day twice', async (): Promise<void> => {
        const storage = new MemorySurveyStorage();
        const store = new SurveyStateStore(storage);

        expect(await store.recordActiveDay('2026-10-07')).toEqual({ changed: true, write: { persisted: true } });
        expect(store.current.activeDayCount).toBe(1);
        expect(storage.update).toHaveBeenCalledWith(
            SURVEY_STATE_KEY,
            expect.objectContaining({ activeDayCount: 1, lastActiveDay: '2026-10-07' }),
        );
        const callsAfterFirstDay = storage.update.mock.calls.length;

        expect(await store.recordActiveDay('2026-10-07')).toEqual({ changed: false });
        expect(storage.update).toHaveBeenCalledTimes(callsAfterFirstDay);
        expect(store.current.activeDayCount).toBe(1);

        expect(await store.recordActiveDay('2026-10-08')).toEqual({ changed: true, write: { persisted: true } });
        expect(store.current.activeDayCount).toBe(2);
        await store.recordActiveDay('2026-10-09');
        expect(store.current.activeDayCount).toBe(3);
        expect(store.current.lastActiveDay).toBe('2026-10-09');
        expect(storage.update.mock.calls.filter(([key]): boolean => key === SURVEY_STATE_KEY)).toHaveLength(3);
    });

    it('updates memory synchronously and leaves previous state objects unchanged', async (): Promise<void> => {
        const storage = new MemorySurveyStorage();
        const store = new SurveyStateStore(storage);
        const initialState = store.current;

        const activeDay = store.recordActiveDay('2026-10-07');
        const activeState = store.current;
        expect(activeState).toEqual({ ...EMPTY_SURVEY_STATE, activeDayCount: 1, lastActiveDay: '2026-10-07' });
        expect(activeState).not.toBe(initialState);

        const outcome = store.recordOutcome('opened', NEXT_ELIGIBLE_AT);
        const outcomeState = store.current;
        expect(outcomeState.lastOutcome).toBe('opened');
        expect(outcomeState.nextEligibleAt).toBe(NEXT_ELIGIBLE_AT.toISOString());
        expect(outcomeState).not.toBe(activeState);

        const optOut = store.recordOptOut(NOW);
        expect(store.isOptedOut).toBe(true);
        expect(store.current).not.toBe(outcomeState);
        expect(initialState).toEqual(EMPTY_SURVEY_STATE);
        expect(activeState.lastOutcome).toBeUndefined();
        expect(outcomeState.optedOutAt).toBeUndefined();
        await Promise.all([activeDay, outcome, optOut]);
    });

    it('round-trips the complete state across a restart', async (): Promise<void> => {
        const storage = new MemorySurveyStorage();
        const store = new SurveyStateStore(storage);
        await store.recordActiveDay('2026-10-07');
        await store.recordOutcome('askLater', NEXT_ELIGIBLE_AT);
        await store.recordOptOut(NOW);
        const callsBeforeRestart = storage.update.mock.calls.length;

        const restartedStore = new SurveyStateStore(storage);

        expect(restartedStore.current).toEqual(store.current);
        expect(restartedStore.current).not.toBe(store.current);
        expect(storage.update).toHaveBeenCalledTimes(callsBeforeRestart);
        expect(storage.getCalls.every((key): boolean => key === SURVEY_STATE_KEY)).toBe(true);
    });

    it('keeps permanent opt-out across restart and all normal mutations, with only an explicit developer reset', async (): Promise<void> => {
        const storage = new MemorySurveyStorage();
        const store = new SurveyStateStore(storage);
        await store.recordOptOut(NOW);
        const restartedStore = new SurveyStateStore(storage);
        expect(restartedStore.isOptedOut).toBe(true);

        await restartedStore.recordActiveDay('2026-10-08');
        await restartedStore.recordOutcome('opened', NEXT_ELIGIBLE_AT);
        await restartedStore.recordOutcome('askLater', NEXT_ELIGIBLE_AT);
        await restartedStore.recordOutcome('dismissed', NEXT_ELIGIBLE_AT);

        expect(restartedStore.current.optedOutAt).toBe(NOW.toISOString());
        expect(restartedStore.isOptedOut).toBe(true);
        expect(new SurveyStateStore(storage).isOptedOut).toBe(true);
        expect(
            Object.getOwnPropertyNames(SurveyStateStore.prototype).filter((name): boolean => /clear|reset/i.test(name)),
        ).toEqual(['reset']);
    });

    it('preserves the original opt-out timestamp while saving repeated opt-outs', async (): Promise<void> => {
        const storage = new MemorySurveyStorage();
        const store = new SurveyStateStore(storage);
        await store.recordOptOut(NOW);
        storage.update.mockClear();

        expect(await store.recordOptOut(NEXT_ELIGIBLE_AT)).toEqual({ persisted: true });

        expect(store.current.optedOutAt).toBe(NOW.toISOString());
        expect(storage.update).toHaveBeenCalledTimes(1);
        expect(storage.update).toHaveBeenCalledWith(SURVEY_STATE_KEY, store.current);
    });

    it('ignores all five legacy values and deletes them only after saving new state', async (): Promise<void> => {
        const storage = new MemorySurveyStorage();
        seedLegacyState(storage);
        const store = new SurveyStateStore(storage);

        expect(LEGACY_SURVEY_STATE_KEYS).toHaveLength(5);
        expect(store.current).toEqual(EMPTY_SURVEY_STATE);
        expect(store.current.activeDayCount).toBe(0);
        expect(store.isOptedOut).toBe(false);
        expect(storage.getCalls).toEqual(Array<string>(4).fill(SURVEY_STATE_KEY));
        expect(LEGACY_SURVEY_STATE_KEYS.every((key): boolean => storage.values.has(key))).toBe(true);
        expect(storage.update).not.toHaveBeenCalled();

        await store.recordActiveDay('2026-10-07');

        expect(storage.update.mock.calls[0]).toEqual([SURVEY_STATE_KEY, store.current]);
        expect(legacyDeletionCalls(storage)).toEqual(
            LEGACY_SURVEY_STATE_KEYS.map((key): [string, undefined] => [key, undefined]),
        );
        expect(LEGACY_SURVEY_STATE_KEYS.some((key): boolean => storage.values.has(key))).toBe(false);
        expect(parseSurveyState(storage.values.get(SURVEY_STATE_KEY))).toEqual(store.current);
    });

    it('does not delete legacy keys on a failed save and deletes them with the next save', async (): Promise<void> => {
        const storage = new MemorySurveyStorage();
        seedLegacyState(storage);
        const error = new Error('State write failed');
        storage.update.mockRejectedValueOnce(error);
        const store = new SurveyStateStore(storage);

        expect(await store.recordActiveDay('2026-10-07')).toEqual({
            changed: true,
            write: { persisted: false, error },
        });
        expect(store.current.activeDayCount).toBe(1);
        expect(store.hasUnsavedChanges).toBe(true);
        expect(legacyDeletionCalls(storage)).toEqual([]);
        expect(LEGACY_SURVEY_STATE_KEYS.every((key): boolean => storage.values.has(key))).toBe(true);
        expect(storage.values.has(SURVEY_STATE_KEY)).toBe(false);

        expect(await store.recordCooldown(NEXT_ELIGIBLE_AT)).toEqual({ persisted: true });
        expect(store.hasUnsavedChanges).toBe(false);
        expect(LEGACY_SURVEY_STATE_KEYS.some((key): boolean => storage.values.has(key))).toBe(false);
        expect(parseSurveyState(storage.values.get(SURVEY_STATE_KEY))).toEqual(store.current);
    });

    it.each(['rejection', 'synchronous throw'] as const)(
        'retries all legacy deletions after a %s and stops deleting once cleanup succeeds',
        async (failureMode): Promise<void> => {
            const storage = new MemorySurveyStorage();
            seedLegacyState(storage);
            const failedKey = LEGACY_SURVEY_STATE_KEYS[2];
            const remainingFailures = new Set([failedKey]);
            const error = new Error('Legacy deletion failed');
            storage.update.mockImplementation((key, value): Promise<void> => {
                if (remainingFailures.delete(key)) {
                    if (failureMode === 'synchronous throw') {
                        throw error;
                    }
                    return Promise.reject(error);
                }
                storage.write(key, value);
                return Promise.resolve();
            });
            const store = new SurveyStateStore(storage);

            expect(await store.recordOptOut(NOW)).toEqual({ persisted: true });
            expect(store.hasUnsavedChanges).toBe(false);
            expect(legacyDeletionCalls(storage)).toHaveLength(5);
            expect(LEGACY_SURVEY_STATE_KEYS.filter((key): boolean => storage.values.has(key))).toEqual([failedKey]);

            expect(await store.recordCooldown(NEXT_ELIGIBLE_AT)).toEqual({ persisted: true });
            expect(legacyDeletionCalls(storage)).toEqual(
                [...LEGACY_SURVEY_STATE_KEYS, ...LEGACY_SURVEY_STATE_KEYS].map((key): [string, undefined] => [
                    key,
                    undefined,
                ]),
            );
            expect(LEGACY_SURVEY_STATE_KEYS.some((key): boolean => storage.values.has(key))).toBe(false);

            await store.recordActiveDay('2026-10-07');
            await store.recordOutcome('dismissed', NEXT_ELIGIBLE_AT);
            await store.recordCooldown(NEXT_ELIGIBLE_AT);
            expect(legacyDeletionCalls(storage)).toHaveLength(10);
        },
    );

    it('waits for legacy cleanup before resolving a successful save', async (): Promise<void> => {
        const storage = new MemorySurveyStorage();
        const cleanup = createDeferred();
        const cleanupStarted = createDeferred();
        storage.update.mockImplementation(async (key, value): Promise<void> => {
            if (key === LEGACY_SURVEY_STATE_KEYS[0]) {
                cleanupStarted.resolve();
                await cleanup.promise;
            }
            storage.write(key, value);
        });
        const store = new SurveyStateStore(storage);
        let saveResolved = false;
        const save = store.recordCooldown(NEXT_ELIGIBLE_AT);
        void save.then((): void => {
            saveResolved = true;
        });

        await cleanupStarted.promise;
        expect(saveResolved).toBe(false);
        expect(legacyDeletionCalls(storage)).toHaveLength(1);
        cleanup.resolve();

        expect(await save).toEqual({ persisted: true });
        expect(saveResolved).toBe(true);
        expect(legacyDeletionCalls(storage)).toHaveLength(5);
    });

    it.each(['rejection', 'synchronous throw'] as const)(
        'keeps opt-out in memory after a write %s and persists it with the next save',
        async (failureMode): Promise<void> => {
            const storage = new MemorySurveyStorage();
            const error = new Error('Opt-out write failed');
            storage.update.mockImplementationOnce((): Promise<void> => {
                if (failureMode === 'synchronous throw') {
                    throw error;
                }
                return Promise.reject(error);
            });
            const store = new SurveyStateStore(storage);

            const write = store.recordOptOut(NOW);
            expect(store.isOptedOut).toBe(true);
            expect(await write).toEqual({ persisted: false, error });
            expect(store.isOptedOut).toBe(true);
            expect(store.hasUnsavedChanges).toBe(true);
            expect(storage.update).toHaveBeenCalledTimes(1);
            expect(storage.update).toHaveBeenCalledWith(SURVEY_STATE_KEY, store.current);
            expect(storage.values.has(SURVEY_STATE_KEY)).toBe(false);

            expect(await store.recordCooldown(NEXT_ELIGIBLE_AT)).toEqual({ persisted: true });
            expect(store.hasUnsavedChanges).toBe(false);
            const restartedStore = new SurveyStateStore(storage);
            expect(restartedStore.isOptedOut).toBe(true);
            expect(restartedStore.current.optedOutAt).toBe(NOW.toISOString());
        },
    );

    it('does not retry a failed active-day write on a same-day no-op', async (): Promise<void> => {
        const storage = new MemorySurveyStorage();
        storage.update.mockRejectedValueOnce(new Error('Write failed'));
        const store = new SurveyStateStore(storage);
        await store.recordActiveDay('2026-10-07');
        storage.update.mockClear();

        expect(await store.recordActiveDay('2026-10-07')).toEqual({ changed: false });
        expect(storage.update).not.toHaveBeenCalled();
        expect(store.hasUnsavedChanges).toBe(true);
    });

    it('records dismissed distinctly from askLater with the ISO cooldown end', async (): Promise<void> => {
        const storage = new MemorySurveyStorage();
        const store = new SurveyStateStore(storage);

        expect(await store.recordOutcome('dismissed', NEXT_ELIGIBLE_AT)).toEqual({ persisted: true });

        expect(store.current.lastOutcome).toBe('dismissed');
        expect(store.current.nextEligibleAt).toBe(NEXT_ELIGIBLE_AT.toISOString());
        expect(parseSurveyState(storage.values.get(SURVEY_STATE_KEY))).toEqual(store.current);
    });

    it('keeps a failed outcome in memory and allows a later save to recover', async (): Promise<void> => {
        const storage = new MemorySurveyStorage();
        const error = new Error('Outcome write failed');
        storage.update.mockRejectedValueOnce(error);
        const store = new SurveyStateStore(storage);

        expect(await store.recordOutcome('dismissed', NEXT_ELIGIBLE_AT)).toEqual({ persisted: false, error });
        expect(store.current.lastOutcome).toBe('dismissed');
        expect(store.current.nextEligibleAt).toBe(NEXT_ELIGIBLE_AT.toISOString());
        expect(store.hasUnsavedChanges).toBe(true);

        await store.recordActiveDay('2026-10-07');
        expect(store.hasUnsavedChanges).toBe(false);
        expect(new SurveyStateStore(storage).current).toEqual(store.current);
    });

    it('refreshes another window opt-out before writing and preserves it across restart', async (): Promise<void> => {
        const storage = new MemorySurveyStorage();
        const a = new SurveyStateStore(storage);
        const b = new SurveyStateStore(storage);
        await a.recordOptOut(NOW);
        const writes = storage.update.mock.calls.length;

        expect(b.isOptedOut).toBe(true);
        expect(storage.update).toHaveBeenCalledTimes(writes);
        await b.recordActiveDay('2026-10-08');

        expect(parseSurveyState(storage.values.get(SURVEY_STATE_KEY))).toMatchObject({
            activeDayCount: 1,
            lastActiveDay: '2026-10-08',
            optedOutAt: NOW.toISOString(),
        });
        expect(new SurveyStateStore(storage).isOptedOut).toBe(true);
    });

    it('preserves another window longer cooldown and its outcome after a shorter outcome', async (): Promise<void> => {
        const storage = new MemorySurveyStorage();
        const a = new SurveyStateStore(storage);
        const b = new SurveyStateStore(storage);
        const longerCooldown = new Date(NOW.getTime() + 180 * 86_400_000);
        await a.recordOutcome('opened', longerCooldown);
        await b.recordOutcome('askLater', new Date(NOW.getTime() + 15 * 86_400_000));

        expect(parseSurveyState(storage.values.get(SURVEY_STATE_KEY))).toMatchObject({
            lastOutcome: 'opened',
            nextEligibleAt: longerCooldown.toISOString(),
        });
        expect(b.current.lastOutcome).toBe('opened');
    });

    it('does not double count or write an active day already counted by another window', async (): Promise<void> => {
        const storage = new MemorySurveyStorage();
        const a = new SurveyStateStore(storage);
        const b = new SurveyStateStore(storage);
        await a.recordActiveDay('2026-10-07');
        const writes = storage.update.mock.calls.length;

        expect(await b.recordActiveDay('2026-10-07')).toEqual({ changed: false });
        expect(storage.update).toHaveBeenCalledTimes(writes);
        expect(b.current.activeDayCount).toBe(1);
        expect(parseSurveyState(storage.values.get(SURVEY_STATE_KEY)).activeDayCount).toBe(1);
    });

    it('merges another window changes on the next save without losing a failed local write', async (): Promise<void> => {
        const storage = new MemorySurveyStorage();
        const a = new SurveyStateStore(storage);
        const b = new SurveyStateStore(storage);
        const error = new Error('Write failed');
        storage.update.mockRejectedValueOnce(error);

        expect(await b.recordActiveDay('2026-10-08')).toEqual({
            changed: true,
            write: { persisted: false, error },
        });
        await a.recordOptOut(NOW);
        await a.recordOutcome('opened', NEXT_ELIGIBLE_AT);
        expect(b.hasUnsavedChanges).toBe(true);
        expect(await b.recordCooldown(NEXT_ELIGIBLE_AT)).toEqual({ persisted: true });

        expect(b.hasUnsavedChanges).toBe(false);
        expect(parseSurveyState(storage.values.get(SURVEY_STATE_KEY))).toEqual({
            ...EMPTY_SURVEY_STATE,
            activeDayCount: 1,
            lastActiveDay: '2026-10-08',
            lastOutcome: 'opened',
            nextEligibleAt: NEXT_ELIGIBLE_AT.toISOString(),
            optedOutAt: NOW.toISOString(),
        });
        expect(new SurveyStateStore(storage).current).toEqual(b.current);
    });

    it('serializes writes despite reverse completion signals and retains both mutations', async (): Promise<void> => {
        const storage = new MemorySurveyStorage();
        const first = createDeferred();
        const second = createDeferred();
        const firstStarted = createDeferred();
        let stateWrites = 0;
        let inFlight = 0;
        let maximumInFlight = 0;
        storage.update.mockImplementation(async (key, value): Promise<void> => {
            if (key === SURVEY_STATE_KEY) {
                stateWrites += 1;
                inFlight += 1;
                maximumInFlight = Math.max(maximumInFlight, inFlight);
                if (stateWrites === 1) {
                    firstStarted.resolve();
                    await first.promise;
                } else {
                    await second.promise;
                }
                inFlight -= 1;
            }
            storage.write(key, value);
        });
        const store = new SurveyStateStore(storage);
        const activeDay = store.recordActiveDay('2026-10-07');
        await firstStarted.promise;
        const optOut = store.recordOptOut(NOW);
        second.resolve();
        await Promise.resolve();

        expect(stateWrites).toBe(1);
        expect(inFlight).toBe(1);
        expect(store.current.activeDayCount).toBe(1);
        expect(store.isOptedOut).toBe(true);
        first.resolve();

        expect(await activeDay).toEqual({ changed: true, write: { persisted: true } });
        expect(await optOut).toEqual({ persisted: true });
        expect(stateWrites).toBe(2);
        expect(maximumInFlight).toBe(1);
        expect(inFlight).toBe(0);
        expect(new SurveyStateStore(storage).current).toEqual({
            ...EMPTY_SURVEY_STATE,
            activeDayCount: 1,
            lastActiveDay: '2026-10-07',
            optedOutAt: NOW.toISOString(),
        });
    });

    it('writes the latest state when each queued save starts rather than an earlier snapshot', async (): Promise<void> => {
        const storage = new MemorySurveyStorage();
        const first = createDeferred();
        const firstStarted = createDeferred();
        let stateWrites = 0;
        storage.update.mockImplementation(async (key, value): Promise<void> => {
            if (key === SURVEY_STATE_KEY && ++stateWrites === 1) {
                firstStarted.resolve();
                await first.promise;
            }
            storage.write(key, value);
        });
        const store = new SurveyStateStore(storage);
        const activeDay = store.recordActiveDay('2026-10-07');
        const optOut = store.recordOptOut(NOW);
        await firstStarted.promise;

        expect(storage.update.mock.calls[0]).toEqual([SURVEY_STATE_KEY, store.current]);
        expect(parseSurveyState(storage.update.mock.calls[0][1]).optedOutAt).toBe(NOW.toISOString());
        const outcome = store.recordOutcome('dismissed', NEXT_ELIGIBLE_AT);
        first.resolve();
        await Promise.all([activeDay, optOut, outcome]);

        const writes = storage.update.mock.calls.filter(([key]): boolean => key === SURVEY_STATE_KEY);
        expect(writes).toHaveLength(3);
        expect(writes[1][1]).toEqual(store.current);
        expect(writes[2][1]).toEqual(store.current);
        expect(parseSurveyState(storage.values.get(SURVEY_STATE_KEY))).toEqual(store.current);
    });

    it('continues queued saves after an earlier write rejects', async (): Promise<void> => {
        const storage = new MemorySurveyStorage();
        const error = new Error('First queued write failed');
        storage.update.mockRejectedValueOnce(error);
        const store = new SurveyStateStore(storage);
        const activeDay = store.recordActiveDay('2026-10-07');
        const optOut = store.recordOptOut(NOW);

        expect(await activeDay).toEqual({ changed: true, write: { persisted: false, error } });
        expect(await optOut).toEqual({ persisted: true });
        expect(store.hasUnsavedChanges).toBe(false);
        expect(new SurveyStateStore(storage).current).toEqual(store.current);
    });

    it('returns failures instead of throwing for invalid date arguments', async (): Promise<void> => {
        const storage = new MemorySurveyStorage();
        const store = new SurveyStateStore(storage);
        const invalidDate = new Date(Number.NaN);

        await expect(store.recordOutcome('dismissed', invalidDate)).resolves.toEqual({
            persisted: false,
            error: expect.any(RangeError),
        });
        await expect(store.recordOptOut(invalidDate)).resolves.toEqual({
            persisted: false,
            error: expect.any(RangeError),
        });
        expect(store.current).toEqual(EMPTY_SURVEY_STATE);
        expect(storage.update).not.toHaveBeenCalled();
    });
});

describe('parseSurveyState', (): void => {
    it('returns a fresh valid v1 state with exactly six fields', (): void => {
        const raw = {
            version: 1,
            activeDayCount: 3,
            lastActiveDay: '2026-10-07',
            lastOutcome: 'dismissed',
            nextEligibleAt: NEXT_ELIGIBLE_AT.toISOString(),
            optedOutAt: NOW.toISOString(),
            extra: 'not persisted',
        };

        const parsed = parseSurveyState(raw);

        expect(parsed).toEqual({
            version: 1,
            activeDayCount: 3,
            lastActiveDay: '2026-10-07',
            lastOutcome: 'dismissed',
            nextEligibleAt: NEXT_ELIGIBLE_AT.toISOString(),
            optedOutAt: NOW.toISOString(),
        });
        expect(parsed).not.toBe(raw);
        expect(Object.keys(parsed)).toEqual(Object.keys(EMPTY_SURVEY_STATE));
    });

    it('accepts missing optional fields dropped by JSON storage', (): void => {
        const raw = { version: 1, activeDayCount: 2 };
        const parsed = parseSurveyState(raw);

        expect(parsed).toEqual({ ...EMPTY_SURVEY_STATE, activeDayCount: 2 });
        expect(Object.keys(parsed)).toEqual(Object.keys(EMPTY_SURVEY_STATE));
    });

    it('accepts a plain object with a null prototype', (): void => {
        const raw: unknown = Object.assign(Object.create(null) as Record<string, unknown>, {
            version: 1,
            activeDayCount: 2,
        });

        expect(parseSurveyState(raw)).toEqual({ ...EMPTY_SURVEY_STATE, activeDayCount: 2 });
    });

    it.each(['opened', 'askLater', 'dismissed'] as const)('accepts the %s outcome', (lastOutcome): void => {
        expect(parseSurveyState({ version: 1, activeDayCount: 0, lastOutcome })).toEqual({
            ...EMPTY_SURVEY_STATE,
            lastOutcome,
        });
    });

    it('accepts timestamp strings without imposing date validation', (): void => {
        expect(
            parseSurveyState({
                version: 1,
                activeDayCount: 0,
                lastActiveDay: '2026-99-99',
                nextEligibleAt: '',
                optedOutAt: '',
            }),
        ).toEqual({ ...EMPTY_SURVEY_STATE, lastActiveDay: '2026-99-99', nextEligibleAt: '', optedOutAt: '' });
    });

    interface InvalidStateCase {
        readonly name: string;
        readonly raw: unknown;
    }

    const invalidStates: readonly InvalidStateCase[] = [
        { name: 'undefined', raw: undefined },
        { name: 'null', raw: null },
        { name: 'array', raw: [] },
        { name: 'array with v1 properties', raw: Object.assign([], { version: 1, activeDayCount: 3 }) },
        { name: 'string', raw: 'state' },
        { name: 'number', raw: 3 },
        { name: 'boolean', raw: true },
        { name: 'bigint', raw: 3n },
        { name: 'symbol', raw: Symbol('state') },
        { name: 'function', raw: (): void => {} },
        { name: 'date', raw: NOW },
        { name: 'non-plain object', raw: Object.create({ version: 1, activeDayCount: 3 }) as unknown },
        { name: 'missing version', raw: { activeDayCount: 3 } },
        { name: 'wrong version', raw: { version: 2, activeDayCount: 3 } },
        { name: 'string version', raw: { version: '1', activeDayCount: 3 } },
        { name: 'missing count', raw: { version: 1 } },
        { name: 'negative count', raw: { version: 1, activeDayCount: -1 } },
        { name: 'non-integer count', raw: { version: 1, activeDayCount: 1.5 } },
        { name: 'NaN count', raw: { version: 1, activeDayCount: Number.NaN } },
        { name: 'infinite count', raw: { version: 1, activeDayCount: Number.POSITIVE_INFINITY } },
        { name: 'negative infinite count', raw: { version: 1, activeDayCount: Number.NEGATIVE_INFINITY } },
        { name: 'string count', raw: { version: 1, activeDayCount: '3' } },
        { name: 'bad day format', raw: { ...EMPTY_SURVEY_STATE, lastActiveDay: '2026-1-07' } },
        { name: 'day with extra characters', raw: { ...EMPTY_SURVEY_STATE, lastActiveDay: '2026-10-07T00:00Z' } },
        { name: 'numeric day', raw: { ...EMPTY_SURVEY_STATE, lastActiveDay: 7 } },
        { name: 'null day', raw: { ...EMPTY_SURVEY_STATE, lastActiveDay: null } },
        { name: 'unknown outcome', raw: { ...EMPTY_SURVEY_STATE, lastOutcome: 'neverAgain' } },
        { name: 'numeric outcome', raw: { ...EMPTY_SURVEY_STATE, lastOutcome: 1 } },
        { name: 'null outcome', raw: { ...EMPTY_SURVEY_STATE, lastOutcome: null } },
        { name: 'numeric cooldown', raw: { ...EMPTY_SURVEY_STATE, nextEligibleAt: 1 } },
        { name: 'null cooldown', raw: { ...EMPTY_SURVEY_STATE, nextEligibleAt: null } },
        { name: 'numeric opt-out', raw: { ...EMPTY_SURVEY_STATE, optedOutAt: 1 } },
        { name: 'null opt-out', raw: { ...EMPTY_SURVEY_STATE, optedOutAt: null } },
    ];

    it.each(invalidStates)('returns a fresh empty state for $name', ({ raw }): void => {
        const parsed = parseSurveyState(raw);

        expect(parsed).toEqual(EMPTY_SURVEY_STATE);
        expect(parsed).not.toBe(EMPTY_SURVEY_STATE);
    });

    it.each([
        { name: 'future version', raw: { version: 2, activeDayCount: 99, optedOutAt: NOW.toISOString() } },
        { name: 'malformed state', raw: { ...EMPTY_SURVEY_STATE, activeDayCount: -1, optedOutAt: NOW.toISOString() } },
        { name: 'otherwise empty object', raw: { optedOutAt: NOW.toISOString() } },
        { name: 'array', raw: Object.assign([], { optedOutAt: NOW.toISOString() }) },
        { name: 'date', raw: Object.assign(new Date(NOW), { optedOutAt: NOW.toISOString() }) },
    ])('preserves permanent opt-out on a $name', ({ raw }): void => {
        expect(parseSurveyState(raw)).toEqual({ ...EMPTY_SURVEY_STATE, optedOutAt: NOW.toISOString() });
    });

    it('keeps opt-out when another property getter throws', (): void => {
        const raw = {
            optedOutAt: NOW.toISOString(),
            get version(): never {
                throw new Error('Version getter failed');
            },
        };

        expect((): SurveyPersistedState => parseSurveyState(raw)).not.toThrow();
        expect(parseSurveyState(raw)).toEqual({ ...EMPTY_SURVEY_STATE, optedOutAt: NOW.toISOString() });
    });

    it('does not throw when the opt-out getter throws', (): void => {
        const raw = {
            get optedOutAt(): never {
                throw new Error('Opt-out getter failed');
            },
        };

        expect((): SurveyPersistedState => parseSurveyState(raw)).not.toThrow();
        expect(parseSurveyState(raw)).toEqual(EMPTY_SURVEY_STATE);
    });

    it('keeps opt-out when inspecting a proxy prototype throws', (): void => {
        const raw = new Proxy(
            { ...EMPTY_SURVEY_STATE, optedOutAt: NOW.toISOString() },
            {
                getPrototypeOf(): never {
                    throw new Error('Prototype trap failed');
                },
            },
        );

        expect((): SurveyPersistedState => parseSurveyState(raw)).not.toThrow();
        expect(parseSurveyState(raw)).toEqual({ ...EMPTY_SURVEY_STATE, optedOutAt: NOW.toISOString() });
    });

    it('does not throw for a revoked proxy', (): void => {
        const { proxy, revoke } = Proxy.revocable({}, {});
        revoke();

        expect((): SurveyPersistedState => parseSurveyState(proxy)).not.toThrow();
        expect(parseSurveyState(proxy)).toEqual(EMPTY_SURVEY_STATE);
    });
});
