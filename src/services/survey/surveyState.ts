/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LEGACY_SURVEY_STATE_KEYS, SURVEY_STATE_KEY } from './surveyConfig';
import { type SurveyLocalDay, type SurveyPersistedState, type SurveyTimedOutcome } from './surveyTypes';

/** The subset of `vscode.Memento` the store needs. `update(key, undefined)` deletes the key. */
export interface SurveyStateStorage {
    get<T>(key: string): T | undefined;
    update(key: string, value: unknown): Thenable<void>;
}

export type SurveyStateWriteResult =
    | { readonly persisted: true }
    | { readonly persisted: false; readonly error: unknown };

export type SurveyActiveDayTransition =
    | { readonly changed: false }
    | { readonly changed: true; readonly write: SurveyStateWriteResult };

/** The state of an installation with no survey history, and the starting point after D0011. */
export const EMPTY_SURVEY_STATE: SurveyPersistedState = {
    version: 1,
    activeDayCount: 0,
    lastActiveDay: undefined,
    lastOutcome: undefined,
    nextEligibleAt: undefined,
    optedOutAt: undefined,
};

/**
 * Validates a value read from `SURVEY_STATE_KEY`. Missing, malformed, or other-version values
 * yield `EMPTY_SURVEY_STATE`, except that a string `optedOutAt` found on any object is kept:
 * an opt-out must never be lost to a parse problem or a downgrade. Never throws.
 */
export function parseSurveyState(raw: unknown): SurveyPersistedState {
    let optedOutAt: unknown;

    try {
        if (typeof raw !== 'object' || raw === null) {
            return { ...EMPTY_SURVEY_STATE };
        }

        const object = raw as Record<string, unknown>;
        // Read the permanent opt-out first so a failure in another field cannot erase it.
        optedOutAt = object.optedOutAt;
        const prototype: unknown = Object.getPrototypeOf(object);
        const { version, activeDayCount, lastActiveDay, lastOutcome, nextEligibleAt } = object;

        if (
            !Array.isArray(object) &&
            (prototype === Object.prototype || prototype === null) &&
            version === 1 &&
            typeof activeDayCount === 'number' &&
            Number.isInteger(activeDayCount) &&
            activeDayCount >= 0 &&
            (lastActiveDay === undefined ||
                (typeof lastActiveDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(lastActiveDay))) &&
            (lastOutcome === undefined ||
                lastOutcome === 'opened' ||
                lastOutcome === 'askLater' ||
                lastOutcome === 'dismissed') &&
            (nextEligibleAt === undefined || typeof nextEligibleAt === 'string') &&
            (optedOutAt === undefined || typeof optedOutAt === 'string')
        ) {
            return { version, activeDayCount, lastActiveDay, lastOutcome, nextEligibleAt, optedOutAt };
        }
    } catch {
        // Storage can contain objects with throwing getters or proxy traps.
    }

    return { ...EMPTY_SURVEY_STATE, optedOutAt: typeof optedOutAt === 'string' ? optedOutAt : undefined };
}

/** Preserves permanent opt-out, maximum activity, and the longest cooldown across windows. */
export function mergeSurveyStates(a: SurveyPersistedState, b: SurveyPersistedState): SurveyPersistedState {
    const optOuts = [a.optedOutAt, b.optedOutAt].filter((value): value is string => value !== undefined);
    const validOptOuts = optOuts.filter((value): boolean => Number.isFinite(Date.parse(value)));
    const aCooldown = Date.parse(a.nextEligibleAt ?? '');
    const bCooldown = Date.parse(b.nextEligibleAt ?? '');
    const aCooldownTime = Number.isNaN(aCooldown) ? Number.NEGATIVE_INFINITY : aCooldown;
    const bCooldownTime = Number.isNaN(bCooldown) ? Number.NEGATIVE_INFINITY : bCooldown;
    const cooldown = bCooldownTime > aCooldownTime ? b : a;

    return {
        version: 1,
        activeDayCount: Math.max(a.activeDayCount, b.activeDayCount),
        lastActiveDay: [a.lastActiveDay, b.lastActiveDay]
            .filter((value): value is SurveyLocalDay => value !== undefined)
            .sort()
            .at(-1),
        lastOutcome: aCooldownTime === bCooldownTime ? (a.lastOutcome ?? b.lastOutcome) : cooldown.lastOutcome,
        nextEligibleAt: cooldown.nextEligibleAt,
        optedOutAt: (validOptOuts.length > 0 ? validOptOuts : optOuts).sort()[0],
    };
}

/**
 * Owns the persisted survey state.
 *
 * - Merges `SURVEY_STATE_KEY` before reads, mutations, and saves. `LEGACY_SURVEY_STATE_KEYS`
 *   are never read for their values (D0011).
 * - Every mutation updates the in-memory state first, synchronously, then saves the whole object.
 *   A failed save keeps the in-memory change (so an opt-out still suppresses for this session),
 *   sets `hasUnsavedChanges`, and returns `{ persisted: false }`. Methods never throw.
 * - Saves are serialized: a later save never completes before an earlier one.
 * - After the first successful save, each legacy key that is present is deleted. A failed
 *   deletion is ignored and retried after the next successful save.
 */
export class SurveyStateStore {
    private readonly storage: SurveyStateStorage;
    private state: SurveyPersistedState;
    private unsavedChanges = false;
    private legacyKeysDeleted = false;
    private saveQueue: Promise<SurveyStateWriteResult> = Promise.resolve({ persisted: true });

    public constructor(storage: SurveyStateStorage) {
        this.storage = storage;
        try {
            this.state = parseSurveyState(storage.get<unknown>(SURVEY_STATE_KEY));
        } catch {
            this.state = { ...EMPTY_SURVEY_STATE };
        }
    }

    public get current(): SurveyPersistedState {
        this.syncFromStorage();
        return this.state;
    }

    public get isOptedOut(): boolean {
        this.syncFromStorage();
        return this.state.optedOutAt !== undefined;
    }

    /** True after a failed save until a later save succeeds. */
    public get hasUnsavedChanges(): boolean {
        return this.unsavedChanges;
    }

    /**
     * Counts `day` as active when it differs from `lastActiveDay`. The same day again is a
     * no-op that does not touch storage.
     */
    public async recordActiveDay(day: SurveyLocalDay): Promise<SurveyActiveDayTransition> {
        this.syncFromStorage();
        if (day === this.state.lastActiveDay) {
            return { changed: false };
        }

        this.state = { ...this.state, activeDayCount: this.state.activeDayCount + 1, lastActiveDay: day };
        return { changed: true, write: await this.save() };
    }

    /** Records a timed outcome and its cooldown end. */
    public async recordOutcome(outcome: SurveyTimedOutcome, nextEligibleAt: Date): Promise<SurveyStateWriteResult> {
        this.syncFromStorage();
        try {
            this.state = mergeSurveyStates(
                { ...this.state, lastOutcome: outcome, nextEligibleAt: nextEligibleAt.toISOString() },
                this.state,
            );
            return await this.save();
        } catch (error) {
            return { persisted: false, error };
        }
    }

    public async recordCooldown(nextEligibleAt: Date): Promise<SurveyStateWriteResult> {
        this.syncFromStorage();
        try {
            this.state = mergeSurveyStates({ ...this.state, nextEligibleAt: nextEligibleAt.toISOString() }, this.state);
            return await this.save();
        } catch (error) {
            return { persisted: false, error };
        }
    }

    /** Records the permanent opt-out ("Never again"). Only the developer reset clears it. */
    public async recordOptOut(now: Date): Promise<SurveyStateWriteResult> {
        this.syncFromStorage();
        try {
            this.state = { ...this.state, optedOutAt: this.state.optedOutAt ?? now.toISOString() };
            return await this.save();
        } catch (error) {
            return { persisted: false, error };
        }
    }

    public reset(): Promise<SurveyStateWriteResult> {
        this.saveQueue = this.saveQueue.then(async (): Promise<SurveyStateWriteResult> => {
            try {
                await this.storage.update(SURVEY_STATE_KEY, undefined);
                this.state = { ...EMPTY_SURVEY_STATE };
                this.unsavedChanges = false;
                return { persisted: true };
            } catch (error) {
                return { persisted: false, error };
            }
        });
        return this.saveQueue;
    }

    private syncFromStorage(): void {
        try {
            const stored = parseSurveyState(this.storage.get<unknown>(SURVEY_STATE_KEY));
            this.state = mergeSurveyStates(this.state, stored);
        } catch {
            // A failed refresh must not erase unsaved changes.
        }
    }

    private save(): Promise<SurveyStateWriteResult> {
        this.saveQueue = this.saveQueue.then((): Promise<SurveyStateWriteResult> => this.persistCurrentState());
        return this.saveQueue;
    }

    private async persistCurrentState(): Promise<SurveyStateWriteResult> {
        try {
            // Take the latest immutable state when this queued write actually starts.
            this.syncFromStorage();
            await this.storage.update(SURVEY_STATE_KEY, this.state);
        } catch (error) {
            this.unsavedChanges = true;
            return { persisted: false, error };
        }

        this.unsavedChanges = false;
        await this.deleteLegacyKeys();
        return { persisted: true };
    }

    private async deleteLegacyKeys(): Promise<void> {
        if (this.legacyKeysDeleted) {
            return;
        }

        let allDeleted = true;
        for (const key of LEGACY_SURVEY_STATE_KEYS) {
            try {
                await this.storage.update(key, undefined);
            } catch {
                allDeleted = false;
            }
        }
        this.legacyKeysDeleted = allDeleted;
    }
}
