/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { DEBUG_SURVEY_ALWAYS_INVITE_ENV } from '../../debug/debugOverrides';
import { ext } from '../../extensionVariables';
import {
    getSurveyService,
    initializeSurveyService,
    recordSurveyActivity,
    SurveyService,
    type SurveyServiceOptions,
} from './SurveyService';
import {
    DEFAULT_SURVEY_POLICY_CONFIG,
    LEGACY_SURVEY_STATE_KEYS,
    SURVEY_FORM_URL,
    SURVEY_STATE_KEY,
} from './surveyConfig';
import { type SurveyInvitationCallbacks, type SurveyInvitationRequest } from './surveyPresentation';
import { EMPTY_SURVEY_STATE, type SurveyStateStorage } from './surveyState';
import { SurveyTelemetry, SurveyTelemetryProperty, type SurveyTelemetryEvent } from './surveyTelemetry';
import { SURVEY_FEATURE_AREAS, SURVEY_GATE_ORDER, type SurveyPersistedState } from './surveyTypes';

jest.mock('vscode', (): object => ({
    ...jest.requireActual<typeof vscode>('../../__mocks__/vscode'),
    ExtensionMode: { Production: 1, Development: 2, Test: 3 },
    env: { machineId: 'test-machine', openExternal: jest.fn() },
}));

jest.mock('@microsoft/vscode-azext-utils', (): object => ({
    callWithTelemetryAndErrorHandling: jest.fn(async (): Promise<void> => undefined),
}));

const INVITATION_ID = '12345678-abcd-4abc-8def-123456789abc';
const OTHER_INVITATION_ID = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
const DAY_MS = 86_400_000;

class MemoryStorage implements SurveyStateStorage {
    public readonly values = new Map<string, unknown>();
    public readonly update = jest.fn<Promise<void>, [string, unknown]>(
        async (key, value): Promise<void> => this.write(key, value),
    );

    public get<T>(key: string): T | undefined {
        return this.values.get(key) as T | undefined;
    }

    public write(key: string, value: unknown): void {
        if (value === undefined) {
            this.values.delete(key);
        } else {
            this.values.set(key, { ...(value as Record<string, unknown>) });
        }
    }
}

interface Deferred<T> {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise): void => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function seedEligible(storage: MemoryStorage): void {
    storage.values.set(SURVEY_STATE_KEY, {
        ...EMPTY_SURVEY_STATE,
        activeDayCount: 2,
        lastActiveDay: '2026-09-30',
    });
}

interface Harness {
    service: SurveyService;
    storage: MemoryStorage;
    flags: { enabled: boolean; permitted: boolean; now: Date };
    sink: jest.Mock<void, [SurveyTelemetryEvent]>;
    present: jest.Mock<Promise<vscode.Disposable | undefined>, [SurveyInvitationRequest, SurveyInvitationCallbacks]>;
    handle: { dispose: jest.Mock<void, []> };
    openExternal: jest.Mock<Promise<boolean>, [string]>;
    events: () => string[];
    sent: (name: string) => SurveyTelemetryEvent[];
    state: () => SurveyPersistedState;
    stateKeyWrites: () => number;
    callbacks: () => SurveyInvitationCallbacks;
}

function createHarness(storage = new MemoryStorage(), overrides: Partial<SurveyServiceOptions> = {}): Harness {
    const flags = { enabled: true, permitted: true, now: new Date(2026, 9, 1, 10, 0) };
    const sink = jest.fn<void, [SurveyTelemetryEvent]>();
    const config = overrides.config ?? DEFAULT_SURVEY_POLICY_CONFIG;
    const telemetry = new SurveyTelemetry({
        campaignId: config.campaignId,
        policyVersion: config.policyVersion,
        isPermitted: (): boolean => flags.permitted,
        sink,
    });
    const openExternal = jest.fn<Promise<boolean>, [string]>().mockResolvedValue(true);
    const handle = { dispose: jest.fn<void, []>() };
    const present = jest
        .fn<Promise<vscode.Disposable | undefined>, [SurveyInvitationRequest, SurveyInvitationCallbacks]>()
        .mockResolvedValue(handle);
    let invitationNumber = 0;
    const service = new SurveyService({
        storage,
        machineId: 'test-machine',
        isSurveyEnabled: (): boolean => flags.enabled,
        isFeedbackPermitted: (): boolean => flags.permitted,
        telemetry,
        now: (): Date => flags.now,
        openExternal,
        createInvitationSessionId: (): string => (++invitationNumber === 1 ? INVITATION_ID : OTHER_INVITATION_ID),
        ...overrides,
    });
    service.setPresenter({ present });
    return {
        service,
        storage,
        flags,
        sink,
        present,
        handle,
        openExternal,
        events: (): string[] => sink.mock.calls.map(([event]): string => event.name),
        sent: (name: string): SurveyTelemetryEvent[] =>
            sink.mock.calls
                .map(([event]): SurveyTelemetryEvent => event)
                .filter((event): boolean => event.name === name),
        state: (): SurveyPersistedState => storage.get<SurveyPersistedState>(SURVEY_STATE_KEY) ?? EMPTY_SURVEY_STATE,
        stateKeyWrites: (): number =>
            storage.update.mock.calls.filter(([key]): boolean => key === SURVEY_STATE_KEY).length,
        callbacks: (): SurveyInvitationCallbacks => present.mock.calls[present.mock.calls.length - 1][1],
    };
}

async function activity(h: Harness): Promise<void> {
    h.service.recordSurveyActivity('connection');
    await h.service.whenIdle();
}

async function invite(h: Harness): Promise<void> {
    for (let day = 1; day <= 3; day++) {
        h.flags.now = new Date(2026, 9, day, 10, 0);
        await activity(h);
    }
    expect(h.present).toHaveBeenCalledTimes(1);
}

function configuration(level: unknown, throwing = false): vscode.WorkspaceConfiguration {
    return {
        get: (): unknown => {
            if (throwing) {
                throw new Error('Settings unavailable');
            }
            return level;
        },
    } as unknown as vscode.WorkspaceConfiguration;
}

describe('SurveyService', (): void => {
    it('reset waits for pending writes and cancels pending presentation', async (): Promise<void> => {
        const storage = new MemoryStorage();
        const started = deferred<void>();
        const pending = deferred<void>();
        storage.update.mockImplementation(async (key, value): Promise<void> => {
            if (key === SURVEY_STATE_KEY && value !== undefined) {
                started.resolve(undefined);
                await pending.promise;
            }
            storage.write(key, value);
        });
        const h = createHarness(storage, { alwaysInvite: true });
        h.service.recordSurveyActivity('connection');
        await started.promise;
        const reset = h.service.resetState();
        pending.resolve(undefined);
        await reset;
        expect(h.present).not.toHaveBeenCalled();
        expect(storage.get(SURVEY_STATE_KEY)).toBeUndefined();
        await activity(h);
        expect(h.present).toHaveBeenCalledTimes(1);
        expect(h.state().activeDayCount).toBe(1);
        h.service.dispose();
    });

    it('debug show-invitation presents now without launch overrides and replaces an open invitation', async (): Promise<void> => {
        const storage = new MemoryStorage();
        storage.values.set(SURVEY_STATE_KEY, {
            ...EMPTY_SURVEY_STATE,
            optedOutAt: '2026-09-30T00:00:00Z',
            nextEligibleAt: '2099-01-01T00:00:00Z',
        });
        const h = createHarness(storage);
        h.flags.enabled = false;
        h.flags.permitted = false;
        await h.service.showInvitationForDebug('connection');
        expect(h.present).toHaveBeenCalledTimes(1);
        expect(h.service.getDebugStatus().invitationActive).toBe(true);
        await h.service.showInvitationForDebug('connection');
        expect(h.handle.dispose).toHaveBeenCalledTimes(1);
        expect(h.present).toHaveBeenCalledTimes(2);
        expect(h.sink).not.toHaveBeenCalled();
        h.service.dispose();
    });

    it('debug always-invite bypasses every gate without bypassing telemetry permission or changing the URL', async (): Promise<void> => {
        const storage = new MemoryStorage();
        storage.values.set(SURVEY_STATE_KEY, {
            ...EMPTY_SURVEY_STATE,
            optedOutAt: '2026-09-30T00:00:00Z',
            nextEligibleAt: '2099-01-01T00:00:00Z',
        });
        const h = createHarness(storage, {
            alwaysInvite: true,
            config: { ...DEFAULT_SURVEY_POLICY_CONFIG, samplingFraction: 0 },
        });
        h.flags.enabled = false;
        h.flags.permitted = false;
        await activity(h);
        expect(h.present).toHaveBeenCalledTimes(1);
        h.callbacks().onVisible();
        h.service.handlePermissionChanged();
        expect(h.handle.dispose).not.toHaveBeenCalled();
        expect(await h.callbacks().onOpenForm()).toBe('opened');
        expect(h.openExternal).toHaveBeenCalledWith(SURVEY_FORM_URL);
        await activity(h);
        expect(h.present).toHaveBeenCalledTimes(2);
        await h.callbacks().onChoice('neverAgain');
        expect(h.sink).not.toHaveBeenCalled();
        h.service.dispose();
    });

    it('reset clears persisted opt-out, cooldown, and session suppression without reloading', async (): Promise<void> => {
        const h = createHarness();
        await invite(h);
        const staleCallbacks = h.callbacks();
        await staleCallbacks.onChoice('neverAgain');
        await h.service.resetState();
        expect(h.storage.get(SURVEY_STATE_KEY)).toBeUndefined();
        expect(await staleCallbacks.onOpenForm()).toBe('blocked');
        for (let day = 1; day <= 3; day++) {
            h.flags.now = new Date(2026, 9, day, 10, 0);
            await activity(h);
        }
        expect(h.present).toHaveBeenCalledTimes(2);
        await h.service.resetState();
        expect(h.handle.dispose).toHaveBeenCalledTimes(2);
        expect(h.storage.get(SURVEY_STATE_KEY)).toBeUndefined();
        h.service.dispose();
    });

    it('Stage 3: a playground-only user qualifies over three local days', async (): Promise<void> => {
        const h = createHarness();
        for (let day = 1; day <= 3; day++) {
            h.flags.now = new Date(2026, 9, day, 10, 0);
            h.service.recordSurveyActivity('queryPlayground');
            await h.service.whenIdle();
            expect(h.state().activeDayCount).toBe(day);
            expect(h.present).toHaveBeenCalledTimes(day === 3 ? 1 : 0);
        }
        expect(h.sent('survey.cohortEntry')[0].properties.featureArea).toBe('queryPlayground');
        expect(h.present.mock.calls[0][0].explanation.requiredActiveDays).toBe(3);
        h.service.dispose();
    });

    it('Stage 3: two successful areas on the same local day add one day and no extra events', async (): Promise<void> => {
        const h = createHarness();
        h.service.recordSurveyActivity('interactiveShell');
        await h.service.whenIdle();
        const events = h.events();
        const writes = h.stateKeyWrites();
        h.service.recordSurveyActivity('queryInsights');
        await h.service.whenIdle();
        expect(h.state().activeDayCount).toBe(1);
        expect(h.stateKeyWrites()).toBe(writes);
        expect(h.events()).toEqual(events);
        expect(events).toEqual(['survey.cohortEntry', 'survey.eligibility']);
        h.service.dispose();
    });

    it('D0019 starts a cooldown only on first visibility, without an outcome or extra event', async (): Promise<void> => {
        const h = createHarness();
        await invite(h);
        expect(h.state().nextEligibleAt).toBeUndefined();
        const callbacks = h.callbacks();
        callbacks.onVisible();
        await h.service.openSurveyFormFromCommand();
        expect(h.state().lastOutcome).toBe('opened');
        expect(h.sent('survey.invitationResolved')).toHaveLength(0);
        expect(h.sent('survey.invitationShown')).toHaveLength(1);
        const cooldown = h.state().nextEligibleAt;
        h.flags.now = new Date(2026, 9, 4, 10, 0);
        callbacks.onVisible();
        await callbacks.onChoice('askLater');
        expect(h.state().nextEligibleAt).toBe(cooldown);
        h.service.dispose();
    });

    it('D0019 persists 14 days without recording a choice, and repeated visibility does not extend it', async (): Promise<void> => {
        const h = createHarness();
        await invite(h);
        const callbacks = h.callbacks();
        callbacks.onVisible();
        await new Promise<void>((resolve): void => {
            setImmediate(resolve);
        });
        expect(h.state().nextEligibleAt).toBe(new Date(h.flags.now.getTime() + 14 * DAY_MS).toISOString());
        expect(h.state().lastOutcome).toBeUndefined();
        const cooldown = h.state().nextEligibleAt;
        const events = h.events();
        h.flags.now = new Date(2026, 9, 4, 10, 0);
        callbacks.onVisible();
        h.service.dispose();
        expect(h.state().nextEligibleAt).toBe(cooldown);
        expect(h.events()).toEqual(events);
        expect(h.sent('survey.invitationResolved')).toHaveLength(0);
    });

    beforeEach((): void => {
        jest.clearAllMocks();
    });

    afterEach((): void => {
        jest.restoreAllMocks();
    });

    it.each([
        { enabled: false, permitted: true },
        { enabled: true, permitted: false },
    ])('keeps kill switch independent of permission: %j', async (flags): Promise<void> => {
        const h = createHarness();
        Object.assign(h.flags, flags);
        await activity(h);
        expect(h.storage.update).not.toHaveBeenCalled();
        expect(h.events()).toEqual([]);
        expect(h.present).not.toHaveBeenCalled();
    });

    it.each([
        { level: 'all', writes: 1 },
        { level: 'error', writes: 0 },
        { level: 'crash', writes: 0 },
        { level: 'off', writes: 0 },
        { level: undefined, writes: 0 },
        { level: 'bogus', writes: 0 },
        { level: 'throwing', writes: 0 },
    ])('uses default feedback permission end to end for $level', async ({ level, writes }): Promise<void> => {
        jest.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue(configuration(level, level === 'throwing'));
        const storage = new MemoryStorage();
        const service = new SurveyService({ storage, machineId: 'test-machine', isSurveyEnabled: (): boolean => true });
        service.recordSurveyActivity('connection');
        await service.whenIdle();
        expect(storage.update.mock.calls.filter(([key]): boolean => key === SURVEY_STATE_KEY)).toHaveLength(writes);
        service.dispose();
    });

    it('D0003/D0004 counts the local midnight boundary and invites exactly on the third active day', async (): Promise<void> => {
        const h = createHarness();
        h.flags.now = new Date(2026, 9, 1, 23, 59);
        await activity(h);
        const first = h.sent('survey.eligibility')[0].properties;
        expect(first).toMatchObject({
            trigger: 'sessionStart',
            firstBlockingGate: 'activeDays',
            gate_sampling: 'passed',
            gate_activeDays: 'blocked',
            gate_cooldown: 'notEvaluated',
            gate_sessionSuppression: 'notEvaluated',
        });
        h.flags.now = new Date(2026, 9, 2, 0, 1);
        await activity(h);
        expect(h.state().activeDayCount).toBe(2);
        expect(h.present).not.toHaveBeenCalled();
        expect(h.sent('survey.eligibility')).toHaveLength(1);
        h.flags.now = new Date(2026, 9, 3, 10, 0);
        await activity(h);
        expect(h.state().activeDayCount).toBe(3);
        expect(h.present).toHaveBeenCalledTimes(1);
        expect(h.sent('survey.eligibility')[1].properties).toMatchObject({
            trigger: 'newActiveDay',
            overall: 'eligible',
        });
        expect(h.present.mock.calls[0][0].explanation).toMatchObject({ activeDayCount: 3, requiredActiveDays: 3 });
    });

    it('makes repeated same-day activity a no-op with one cohort entry', async (): Promise<void> => {
        const h = createHarness();
        await activity(h);
        const writes = h.storage.update.mock.calls.length;
        const events = h.events();
        for (let index = 0; index < 10; index++) {
            h.service.recordSurveyActivity('dataBrowsing');
        }
        await h.service.whenIdle();
        expect(h.storage.update).toHaveBeenCalledTimes(writes);
        expect(h.events()).toEqual(events);
        expect(h.sent('survey.cohortEntry')).toHaveLength(1);
    });

    it('coalesces five concurrent feature milestones into one write, evaluation, and reserved invitation', async (): Promise<void> => {
        const storage = new MemoryStorage();
        seedEligible(storage);
        const pending = deferred<void>();
        storage.update.mockImplementation(async (key, value): Promise<void> => {
            if (key === SURVEY_STATE_KEY) {
                await pending.promise;
            }
            storage.write(key, value);
        });
        const h = createHarness(storage);
        for (const area of SURVEY_FEATURE_AREAS.slice(0, 5)) {
            h.service.recordSurveyActivity(area);
        }
        pending.resolve();
        await h.service.whenIdle();
        expect(h.stateKeyWrites()).toBe(1);
        expect(h.sent('survey.eligibility')).toHaveLength(1);
        expect(h.sent('survey.cohortEntry')).toHaveLength(1);
        expect(h.present).toHaveBeenCalledTimes(1);
    });

    it('keeps Never again permanent across campaigns, ten years, and extension versions (version is not an input)', async (): Promise<void> => {
        const h = createHarness();
        await invite(h);
        h.callbacks().onVisible();
        await new Promise<void>((resolve): void => {
            setImmediate(resolve);
        });
        const pending = deferred<void>();
        const started = deferred<void>();
        const order: string[] = [];
        h.storage.update.mockImplementation(async (key, value): Promise<void> => {
            if (key === SURVEY_STATE_KEY) {
                started.resolve();
                await pending.promise;
                order.push('optOutSaved');
            }
            h.storage.write(key, value);
        });
        h.handle.dispose.mockImplementation((): void => {
            order.push('disposed');
        });
        const choice = h.callbacks().onChoice('neverAgain');
        await started.promise;
        expect(h.handle.dispose).not.toHaveBeenCalled();
        pending.resolve();
        await choice;
        expect(order).toEqual(['optOutSaved', 'disposed']);
        expect(h.sent('survey.invitationResolved')[0].properties).toMatchObject({
            outcome: 'neverAgain',
            wasVisible: 'true',
        });
        h.service.dispose();
        for (const config of [
            { ...DEFAULT_SURVEY_POLICY_CONFIG, campaignId: 'documentdb-new-campaign', policyVersion: '2' },
            DEFAULT_SURVEY_POLICY_CONFIG,
        ]) {
            const next = createHarness(h.storage, { config });
            next.flags.now = new Date(2036, 9, 3, 10, 0);
            const writes = next.storage.update.mock.calls.length;
            await activity(next);
            expect(next.storage.update).toHaveBeenCalledTimes(writes);
            expect(next.events()).toEqual([]);
            expect(next.present).not.toHaveBeenCalled();
        }
    });

    it('honors Never again from another window before activity, without writes, events, or presentation', async (): Promise<void> => {
        const storage = new MemoryStorage();
        const a = createHarness(storage);
        const b = createHarness(storage);
        await invite(a);
        await a.callbacks().onChoice('neverAgain');
        const optedOutAt = a.state().optedOutAt;
        const writes = storage.update.mock.calls.length;
        b.flags.now = new Date(2026, 9, 4, 10, 0);

        await activity(b);

        expect(optedOutAt).toBeDefined();
        expect(storage.update).toHaveBeenCalledTimes(writes);
        expect(b.state().optedOutAt).toBe(optedOutAt);
        expect(b.events()).toEqual([]);
        expect(b.present).not.toHaveBeenCalled();
    });

    it('D0011 forgets all five legacy keys including opt-out and large session counts', async (): Promise<void> => {
        const storage = new MemoryStorage();
        const legacyValues = [
            9999,
            '2026-10-01',
            '999.0.0',
            new Date(2026, 9, 1).toISOString(),
            new Date(2026, 9, 1).toISOString(),
        ];
        LEGACY_SURVEY_STATE_KEYS.forEach((key, index): void => {
            storage.values.set(key, legacyValues[index]);
        });
        const h = createHarness(storage);
        await activity(h);
        expect(h.sent('survey.cohortEntry')).toHaveLength(1);
        expect(h.state().activeDayCount).toBe(1);
        expect(h.present).not.toHaveBeenCalled();
        for (const key of LEGACY_SURVEY_STATE_KEYS) {
            expect(storage.values.has(key)).toBe(false);
            expect(storage.update).toHaveBeenCalledWith(key, undefined);
        }
    });

    it('honors a failed opt-out write in memory for the session and reports it once', async (): Promise<void> => {
        const report = jest.fn<void, []>();
        const h = createHarness(new MemoryStorage(), { reportOptOutSaveFailure: report });
        await invite(h);
        h.storage.update.mockRejectedValueOnce(new Error('Storage unavailable'));
        await h.callbacks().onChoice('neverAgain');
        expect(report).toHaveBeenCalledTimes(1);
        expect(h.handle.dispose).toHaveBeenCalledTimes(1);
        const events = h.events();
        const writes = h.stateKeyWrites();
        h.flags.now = new Date(2026, 9, 4, 10, 0);
        await activity(h);
        expect(h.events()).toEqual(events);
        expect(h.stateKeyWrites()).toBe(writes);
        expect(h.present).toHaveBeenCalledTimes(1);
        expect(report).toHaveBeenCalledWith();
        // Accepted edge case (D0027): without a retry, the opt-out is not persisted for the next session.
        expect(h.state().optedOutAt).toBeUndefined();
    });

    it('surfaces a failed opt-out save even when permission is withdrawn during the save, without events', async (): Promise<void> => {
        const report = jest.fn<void, []>();
        const h = createHarness(new MemoryStorage(), { reportOptOutSaveFailure: report });
        await invite(h);
        h.callbacks().onVisible();
        await new Promise<void>((resolve): void => {
            setImmediate(resolve);
        });
        const save = deferred<void>();
        h.storage.update.mockImplementationOnce(async (): Promise<void> => save.promise);
        const choice = h.callbacks().onChoice('neverAgain');
        const eventsBeforeWithdrawal = h.events();
        h.flags.permitted = false;
        h.service.handlePermissionChanged();
        save.reject(new Error('Storage unavailable'));
        await choice;
        expect(report).toHaveBeenCalledTimes(1);
        expect(h.events()).toEqual(eventsBeforeWithdrawal);
        expect(h.sent('survey.invitationResolved')).toEqual([]);
        expect(h.handle.dispose).toHaveBeenCalledTimes(1);
    });

    it('reports a failed opt-out save once in a localized modal without a retry action', async (): Promise<void> => {
        const h = createHarness();
        await invite(h);
        h.storage.update.mockRejectedValueOnce(new Error('Storage unavailable'));
        const notification = jest.spyOn(vscode.window, 'showErrorMessage').mockResolvedValue(undefined);
        await h.callbacks().onChoice('neverAgain');
        expect(notification).toHaveBeenCalledTimes(1);
        expect(notification).toHaveBeenCalledWith(
            'Saving your choice not to be asked for feedback again failed. It still applies until VS Code restarts.',
            { modal: true },
        );
        expect(h.handle.dispose).toHaveBeenCalledTimes(1);
    });

    it('handles opt-out error-notification rejection without an unhandled promise', async (): Promise<void> => {
        const h = createHarness();
        await invite(h);
        h.storage.update.mockRejectedValueOnce(new Error('Storage unavailable'));
        const notification = jest
            .spyOn(vscode.window, 'showErrorMessage')
            .mockRejectedValue(new Error('UI unavailable'));
        await expect(h.callbacks().onChoice('neverAgain')).resolves.toBeUndefined();
        expect(notification).toHaveBeenCalledTimes(1);
        expect(h.handle.dispose).toHaveBeenCalledTimes(1);
    });

    it.each([
        { outcome: 'dismissed' as const, days: 5 },
        { outcome: 'askLater' as const, days: 14 },
    ])('records $outcome with its independent $days-day cooldown', async ({ outcome, days }): Promise<void> => {
        const h = createHarness(new MemoryStorage(), {
            config: { ...DEFAULT_SURVEY_POLICY_CONFIG, askLaterCooldownDays: 14, dismissedCooldownDays: 5 },
        });
        await invite(h);
        await h.callbacks().onChoice(outcome);
        expect(h.state()).toMatchObject({
            lastOutcome: outcome,
            nextEligibleAt: new Date(h.flags.now.getTime() + days * DAY_MS).toISOString(),
        });
        expect(h.sent('survey.invitationResolved')[0].properties.outcome).toBe(outcome);
        expect(h.handle.dispose).toHaveBeenCalledTimes(1);
    });

    it('cancels a pending presentation on permission withdrawal and ignores all late callbacks', async (): Promise<void> => {
        const storage = new MemoryStorage();
        seedEligible(storage);
        const h = createHarness(storage);
        const pending = deferred<vscode.Disposable | undefined>();
        const started = deferred<void>();
        h.present.mockImplementation((): Promise<vscode.Disposable | undefined> => {
            started.resolve();
            return pending.promise;
        });
        h.service.recordSurveyActivity('connection');
        await started.promise;
        const callbacks = h.callbacks();
        const events = h.events();
        h.flags.permitted = false;
        h.service.handlePermissionChanged();
        pending.resolve(h.handle);
        await h.service.whenIdle();
        expect(h.handle.dispose).toHaveBeenCalledTimes(1);
        callbacks.onVisible();
        await callbacks.onChoice('dismissed');
        expect(await callbacks.onOpenForm()).toBe('blocked');
        expect(h.openExternal).not.toHaveBeenCalled();
        expect(h.events()).toEqual(events);
        expect(h.state().lastOutcome).toBeUndefined();
        expect(h.state().nextEligibleAt).toBeUndefined();
    });

    it('resumes activity after withdrawal from a never-settling presentation without releasing session suppression', async (): Promise<void> => {
        const storage = new MemoryStorage();
        seedEligible(storage);
        const h = createHarness(storage);
        const pending = deferred<vscode.Disposable | undefined>();
        const started = deferred<void>();
        h.present.mockImplementation((): Promise<vscode.Disposable | undefined> => {
            started.resolve();
            return pending.promise;
        });
        h.service.recordSurveyActivity('connection');
        await started.promise;
        expect(h.state().activeDayCount).toBe(3);
        const writes = h.stateKeyWrites();

        h.flags.permitted = false;
        h.service.handlePermissionChanged();
        await h.service.whenIdle();
        h.flags.permitted = true;
        h.flags.now = new Date(2026, 9, 2, 10, 0);
        await activity(h);

        expect(h.stateKeyWrites()).toBe(writes + 1);
        expect(h.state()).toMatchObject({ activeDayCount: 4, lastActiveDay: '2026-10-02' });
        expect(h.sent('survey.eligibility').at(-1)?.properties.firstBlockingGate).toBe('sessionSuppression');
        expect(h.present).toHaveBeenCalledTimes(1);
        expect(h.handle.dispose).not.toHaveBeenCalled();
        expect(h.state().lastOutcome).toBeUndefined();
    });

    it('closes a visible invitation silently on permission withdrawal exactly once', async (): Promise<void> => {
        const h = createHarness();
        await invite(h);
        h.callbacks().onVisible();
        const events = h.events();
        h.service.handlePermissionChanged();
        expect(h.handle.dispose).not.toHaveBeenCalled();
        h.flags.permitted = false;
        h.service.handlePermissionChanged();
        h.service.handlePermissionChanged();
        h.callbacks().onVisible();
        await h.callbacks().onChoice('dismissed');
        expect(h.handle.dispose).toHaveBeenCalledTimes(1);
        expect(h.events()).toEqual(events);
        expect(h.state().lastOutcome).toBeUndefined();
    });

    it('cancels eligibility after withdrawal during an active-day write even if permission is restored', async (): Promise<void> => {
        const h = createHarness();
        const pending = deferred<void>();
        const started = deferred<void>();
        h.storage.update.mockImplementation(async (key, value): Promise<void> => {
            if (key === SURVEY_STATE_KEY) {
                started.resolve();
                await pending.promise;
            }
            h.storage.write(key, value);
        });
        h.service.recordSurveyActivity('connection');
        await started.promise;
        h.flags.permitted = false;
        h.service.handlePermissionChanged();
        h.flags.permitted = true;
        pending.resolve();
        await h.service.whenIdle();
        expect(h.sent('survey.eligibility')).toHaveLength(0);
        expect(h.events()).toEqual(['survey.cohortEntry']);
    });

    it('opens the exact form URL, reports success then resolution, and applies the 180-day cooldown', async (): Promise<void> => {
        const h = createHarness();
        await invite(h);
        h.callbacks().onVisible();
        h.callbacks().onVisible();
        expect(h.sent('survey.invitationShown')).toHaveLength(1);
        expect(await h.callbacks().onOpenForm()).toBe('opened');
        expect(h.openExternal).toHaveBeenCalledWith('https://aka.ms/DocumentDBSurvey');
        expect(h.events().slice(-2)).toEqual(['survey.openForm', 'survey.invitationResolved']);
        expect(h.sent('survey.openForm')[0]).toMatchObject({
            properties: { openResult: 'success', trigger: 'invitation', invitationSessionId: INVITATION_ID },
            measurements: { attempt: 1 },
        });
        expect(h.sent('survey.invitationResolved')[0].properties.outcome).toBe('opened');
        expect(h.state().nextEligibleAt).toBe(new Date(h.flags.now.getTime() + 180 * DAY_MS).toISOString());
        expect(h.handle.dispose).toHaveBeenCalledTimes(1);
    });

    it('allows four explicit failed opens then success with only three numbered telemetry attempts', async (): Promise<void> => {
        const h = createHarness();
        await invite(h);
        h.openExternal.mockResolvedValue(false);
        h.openExternal.mockRejectedValueOnce(new Error('Browser unavailable'));
        for (let attempt = 1; attempt <= 4; attempt++) {
            expect(await h.callbacks().onOpenForm()).toBe('failed');
            expect(h.state().nextEligibleAt).toBeUndefined();
            expect(h.handle.dispose).not.toHaveBeenCalled();
            expect(h.sent('survey.invitationResolved')).toHaveLength(0);
        }
        h.openExternal.mockResolvedValue(true);
        expect(await h.callbacks().onOpenForm()).toBe('opened');
        expect(h.openExternal.mock.calls).toEqual(Array.from({ length: 5 }, (): string[] => [SURVEY_FORM_URL]));
        expect(h.sent('survey.openForm').map((event): number => event.measurements.attempt)).toEqual([1, 2, 3]);
        expect(h.sent('survey.openForm').every((event): boolean => event.properties.openResult === 'failure')).toBe(
            true,
        );
        expect(h.state().nextEligibleAt).toBe(new Date(h.flags.now.getTime() + 180 * DAY_MS).toISOString());
        expect(h.state().lastOutcome).toBe('opened');
        expect(h.handle.dispose).toHaveBeenCalledTimes(1);
        expect(h.sent('survey.invitationResolved')).toHaveLength(1);
    });

    it('records the optional rating only on opening attempts, not in URLs, state, or other events', async (): Promise<void> => {
        const h = createHarness();
        await invite(h);
        h.openExternal.mockResolvedValueOnce(false);
        expect(await h.callbacks().onOpenForm(2)).toBe('failed');
        expect(await h.callbacks().onOpenForm(4)).toBe('opened');
        expect(h.sent('survey.openForm').map((event): unknown => event.measurements)).toEqual([
            { attempt: 1, selectedRating: 2 },
            { attempt: 2, selectedRating: 4 },
        ]);
        expect(h.openExternal.mock.calls).toEqual([[SURVEY_FORM_URL], [SURVEY_FORM_URL]]);
        expect(h.state()).not.toHaveProperty('selectedRating');
        for (const [event] of h.sink.mock.calls) {
            expect(event.properties).not.toHaveProperty('selectedRating');
            if (event.name !== 'survey.openForm') {
                expect(event.measurements).not.toHaveProperty('selectedRating');
            }
        }
    });

    it('does not emit a selected rating after feedback permission is withdrawn during opening', async (): Promise<void> => {
        const h = createHarness();
        await invite(h);
        const pending = deferred<boolean>();
        h.openExternal.mockReturnValue(pending.promise);
        const opening = h.callbacks().onOpenForm(5);
        h.flags.permitted = false;
        h.service.handlePermissionChanged();
        pending.resolve(true);
        expect(await opening).toBe('opened');
        expect(h.sent('survey.openForm')).toHaveLength(0);
        expect(h.state()).not.toHaveProperty('selectedRating');
    });

    it.each(['disabled', 'notPermitted'] as const)(
        'blocks invitation opening when %s without events',
        async (condition): Promise<void> => {
            const h = createHarness();
            await invite(h);
            if (condition === 'disabled') {
                h.flags.enabled = false;
            } else {
                h.flags.permitted = false;
            }
            const events = h.events();
            expect(await h.callbacks().onOpenForm()).toBe('blocked');
            expect(h.openExternal).not.toHaveBeenCalled();
            expect(h.events()).toEqual(events);
        },
    );

    it('retries same-day presenter deferral without duplicate eligibility or deferral events', async (): Promise<void> => {
        const storage = new MemoryStorage();
        seedEligible(storage);
        const h = createHarness(storage);
        h.service.setPresenter(undefined);
        await activity(h);
        await activity(h);
        expect(h.sent('survey.presentationDeferred')).toHaveLength(1);
        expect(h.sent('survey.presentationDeferred')[0].properties.reason).toBe('presenterUnavailable');
        expect(h.sent('survey.eligibility')).toHaveLength(1);
        h.service.setPresenter({ present: h.present });
        await activity(h);
        expect(h.present).toHaveBeenCalledTimes(1);
        expect(h.sent('survey.eligibility')).toHaveLength(1);
        expect(h.stateKeyWrites()).toBe(1);
    });

    it.each([
        { label: 'undefined handle', reason: 'presenterUnavailable', fails: false },
        { label: 'presenter rejection', reason: 'presentationFailed', fails: true },
    ])('releases the reservation after $label and retries', async ({ reason, fails }): Promise<void> => {
        const storage = new MemoryStorage();
        seedEligible(storage);
        const h = createHarness(storage);
        if (fails) {
            h.present.mockRejectedValueOnce(new Error('Presentation unavailable'));
        } else {
            h.present.mockResolvedValueOnce(undefined);
        }
        await activity(h);
        expect(h.sent('survey.presentationDeferred')[0].properties.reason).toBe(reason);
        await activity(h);
        expect(h.present).toHaveBeenCalledTimes(2);
        expect(h.sent('survey.eligibility')).toHaveLength(1);
    });

    it('suppresses another invitation in the same session after Ask later and cooldown expiry', async (): Promise<void> => {
        const h = createHarness();
        await invite(h);
        await h.callbacks().onChoice('askLater');
        await activity(h);
        expect(h.sent('survey.eligibility').at(-1)?.properties).toMatchObject({
            trigger: 'stateChange',
            firstBlockingGate: 'cooldown',
            gate_cooldown: 'blocked',
            gate_sessionSuppression: 'notEvaluated',
        });
        h.flags.now = new Date(2027, 0, 1, 10, 0);
        await activity(h);
        expect(h.sent('survey.eligibility').at(-1)?.properties.firstBlockingGate).toBe('sessionSuppression');
        expect(h.present).toHaveBeenCalledTimes(1);
    });

    it.each([
        { enabled: true, permitted: true, optedOut: false, reports: true, cooldown: true },
        { enabled: true, permitted: true, optedOut: true, reports: true, cooldown: false },
        { enabled: false, permitted: true, optedOut: false, reports: false, cooldown: false },
        { enabled: true, permitted: false, optedOut: false, reports: false, cooldown: false },
        { enabled: false, permitted: false, optedOut: true, reports: false, cooldown: false },
    ])(
        'command always opens while respecting reporting, cooldown, and permanent opt-out: %j',
        async (flags): Promise<void> => {
            const storage = new MemoryStorage();
            const optedOutAt = new Date(2026, 8, 1, 10, 0).toISOString();
            if (flags.optedOut) {
                storage.values.set(SURVEY_STATE_KEY, { ...EMPTY_SURVEY_STATE, optedOutAt });
            }
            const h = createHarness(storage);
            Object.assign(h.flags, flags);
            expect(await h.service.openSurveyFormFromCommand()).toBe('opened');
            expect(h.openExternal.mock.calls).toEqual([[SURVEY_FORM_URL]]);
            expect(h.sent('survey.openForm')).toHaveLength(flags.reports ? 1 : 0);
            if (flags.reports) {
                expect(h.sent('survey.openForm')[0]).toMatchObject({
                    properties: { trigger: 'command', openResult: 'success' },
                    measurements: { attempt: 1 },
                });
                expect(h.sent('survey.openForm')[0].properties.invitationSessionId).toBeUndefined();
            }
            expect(h.stateKeyWrites()).toBe(flags.cooldown ? 1 : 0);
            expect(h.state().nextEligibleAt).toBe(
                flags.cooldown ? new Date(h.flags.now.getTime() + 180 * DAY_MS).toISOString() : undefined,
            );
            expect(h.state().optedOutAt).toBe(flags.optedOut ? optedOutAt : undefined);
        },
    );

    it('command checks fresh settings after the browser await and returns failed on browser rejection', async (): Promise<void> => {
        const h = createHarness();
        const pending = deferred<boolean>();
        h.openExternal.mockReturnValueOnce(pending.promise);
        const command = h.service.openSurveyFormFromCommand();
        h.flags.enabled = false;
        h.flags.permitted = false;
        pending.resolve(true);
        expect(await command).toBe('opened');
        expect(h.events()).toEqual([]);
        expect(h.stateKeyWrites()).toBe(0);
        h.flags.enabled = true;
        h.flags.permitted = true;
        h.openExternal.mockRejectedValueOnce(new Error('Browser unavailable'));
        expect(await h.service.openSurveyFormFromCommand()).toBe('failed');
        expect(h.sent('survey.openForm')[0].properties.openResult).toBe('failure');
        expect(h.stateKeyWrites()).toBe(0);
    });

    it('never throws for a throwing storage read, telemetry sink, or kill-switch getter', async (): Promise<void> => {
        const storage = new MemoryStorage();
        jest.spyOn(storage, 'get').mockImplementation((): never => {
            throw new Error('Read unavailable');
        });
        const h = createHarness(storage);
        h.sink.mockImplementation((): never => {
            throw new Error('Telemetry unavailable');
        });
        expect((): void => h.service.recordSurveyActivity('connection')).not.toThrow();
        await h.service.whenIdle();
        expect(h.stateKeyWrites()).toBe(1);
        const broken = createHarness(new MemoryStorage(), {
            isSurveyEnabled: (): never => {
                throw new Error('Policy unavailable');
            },
        });
        expect((): void => broken.service.recordSurveyActivity('connection')).not.toThrow();
        await broken.service.whenIdle();
        expect(broken.events()).toEqual([]);
        expect(broken.stateKeyWrites()).toBe(0);
    });

    it('disposes pending work silently and makes future activity a no-op', async (): Promise<void> => {
        const storage = new MemoryStorage();
        seedEligible(storage);
        const h = createHarness(storage);
        const pending = deferred<vscode.Disposable | undefined>();
        const started = deferred<void>();
        h.present.mockImplementation((): Promise<vscode.Disposable | undefined> => {
            started.resolve();
            return pending.promise;
        });
        h.service.recordSurveyActivity('connection');
        await started.promise;
        const events = h.events();
        h.service.dispose();
        pending.resolve(h.handle);
        await h.service.whenIdle();
        expect(h.handle.dispose).toHaveBeenCalledTimes(1);
        await activity(h);
        expect(h.events()).toEqual(events);
        expect(h.state().lastOutcome).toBeUndefined();
        expect(h.stateKeyWrites()).toBe(1);
    });

    it('becomes idle after disposal of a never-settling presentation', async (): Promise<void> => {
        const storage = new MemoryStorage();
        seedEligible(storage);
        const h = createHarness(storage);
        const pending = deferred<vscode.Disposable | undefined>();
        const started = deferred<void>();
        h.present.mockImplementation((): Promise<vscode.Disposable | undefined> => {
            started.resolve();
            return pending.promise;
        });
        h.service.recordSurveyActivity('connection');
        await started.promise;
        const events = h.events();
        const writes = h.stateKeyWrites();

        h.service.dispose();
        await h.service.whenIdle();
        h.flags.now = new Date(2026, 9, 2, 10, 0);
        await activity(h);

        expect(h.events()).toEqual(events);
        expect(h.stateKeyWrites()).toBe(writes);
        expect(h.present).toHaveBeenCalledTimes(1);
        expect(h.state().lastOutcome).toBeUndefined();
    });

    it('ignores an open result after permission withdrawal without cooldown or lifecycle events', async (): Promise<void> => {
        const h = createHarness();
        await invite(h);
        const pending = deferred<boolean>();
        h.openExternal.mockReturnValueOnce(pending.promise);
        const opening = h.callbacks().onOpenForm();
        const events = h.events();
        h.flags.permitted = false;
        h.service.handlePermissionChanged();
        h.flags.permitted = true;
        pending.resolve(true);
        expect(await opening).toBe('opened');
        expect(h.events()).toEqual(events);
        expect(h.state().nextEligibleAt).toBeUndefined();
    });

    it('guards outcome continuations after withdrawal and keeps handle disposal idempotent', async (): Promise<void> => {
        const h = createHarness();
        await invite(h);
        const pending = deferred<void>();
        const started = deferred<void>();
        h.storage.update.mockImplementation(async (key, value): Promise<void> => {
            if (key === SURVEY_STATE_KEY) {
                started.resolve();
                await pending.promise;
            }
            h.storage.write(key, value);
        });
        const choice = h.callbacks().onChoice('askLater');
        await started.promise;
        const events = h.events();
        h.flags.permitted = false;
        h.service.handlePermissionChanged();
        h.flags.permitted = true;
        pending.resolve();
        await choice;
        expect(h.events()).toEqual(events);
        expect(h.handle.dispose).toHaveBeenCalledTimes(1);
    });

    it('privacy smoke test sends only approved properties and never URLs or the usage count through a full journey', async (): Promise<void> => {
        const h = createHarness();
        await invite(h);
        h.callbacks().onVisible();
        h.openExternal.mockResolvedValueOnce(false);
        expect(await h.callbacks().onOpenForm()).toBe('failed');
        expect(await h.callbacks().onOpenForm()).toBe('opened');
        const approved: readonly string[] = [
            ...Object.values(SurveyTelemetryProperty),
            ...SURVEY_GATE_ORDER.map((gate): string => `gate_${gate}`),
        ];
        expect(h.events()).toEqual([
            'survey.cohortEntry',
            'survey.eligibility',
            'survey.eligibility',
            'survey.invitationShown',
            'survey.openForm',
            'survey.openForm',
            'survey.invitationResolved',
        ]);
        for (const [event] of h.sink.mock.calls) {
            for (const [key, value] of Object.entries(event.properties)) {
                expect(approved).toContain(key);
                expect(value).not.toContain('http');
                expect(value).not.toBe(String(h.state().activeDayCount));
            }
            expect(Object.keys(event.measurements).every((key): boolean => key === 'attempt')).toBe(true);
        }
    });
});

describe('survey local diagnostics', (): void => {
    let originalOutputChannel: typeof ext.outputChannel;
    let trace: jest.Mock<void, [string]>;

    beforeEach((): void => {
        originalOutputChannel = ext.outputChannel;
        trace = jest.fn<void, [string]>();
        ext.outputChannel = { trace } as unknown as typeof ext.outputChannel;
    });

    afterEach((): void => {
        ext.outputChannel = originalOutputChannel;
    });

    it.each([
        { condition: 'disabled', reason: 'survey disabled' },
        { condition: 'permission', reason: 'feedback not permitted' },
        { condition: 'optOut', reason: 'opted out' },
        { condition: 'disposed', reason: 'service disposed' },
    ])('explains $condition admission without collecting activity', async ({ condition, reason }): Promise<void> => {
        const storage = new MemoryStorage();
        seedEligible(storage);
        if (condition === 'optOut') {
            storage.values.set(SURVEY_STATE_KEY, {
                ...storage.get<SurveyPersistedState>(SURVEY_STATE_KEY),
                optedOutAt: '2026-09-30T00:00:00Z',
            });
        }
        const now = jest.fn((): Date => new Date(2026, 9, 1, 10));
        const h = createHarness(storage, { now });
        h.flags.enabled = condition !== 'disabled';
        h.flags.permitted = condition !== 'permission';
        if (condition === 'disposed') {
            h.service.dispose();
        }
        await activity(h);
        expect(trace.mock.calls).toEqual([[`[Survey] Admission suppressed: ${reason}.`]]);
        expect(now).not.toHaveBeenCalled();
        expect(h.state().activeDayCount).toBe(2);
        expect(storage.update).not.toHaveBeenCalled();
        expect(h.events()).toEqual([]);
        h.service.dispose();
    });

    it('fails closed with a generic trace when a precondition reader throws', async (): Promise<void> => {
        const h = createHarness(undefined, {
            isFeedbackPermitted: (): boolean => {
                throw new Error('mongodb://private-host/private-db?password=secret');
            },
        });
        await activity(h);
        expect(trace.mock.calls).toEqual([['[Survey] Admission suppressed: preconditions unavailable.']]);
        expect(h.storage.update).not.toHaveBeenCalled();
        expect(h.events()).toEqual([]);
        h.service.dispose();
    });

    it('acknowledges finite areas and distinguishes new versus already-counted days without extra counts or events', async (): Promise<void> => {
        const h = createHarness();
        h.service.recordSurveyActivity('queryPlayground');
        await h.service.whenIdle();
        expect(trace).toHaveBeenCalledWith('[Survey] Acknowledged usage: queryPlayground.');
        expect(trace).toHaveBeenCalledWith('[Survey] Counted a new active day: 1 of 3 required.');
        expect(trace).toHaveBeenCalledWith('[Survey] Persistence active day: succeeded.');
        expect(trace).toHaveBeenCalledWith('[Survey] Not showing invitation: active-day threshold not reached.');
        const events = h.events();
        const writes = h.stateKeyWrites();
        trace.mockClear();
        h.service.recordSurveyActivity('queryInsights');
        await h.service.whenIdle();
        expect(trace.mock.calls).toEqual([
            ['[Survey] Acknowledged usage: queryInsights.'],
            ['[Survey] Active day already counted: 1 of 3 required.'],
            ["[Survey] Skipping evaluation: today's activity was already evaluated."],
        ]);
        expect(h.state().activeDayCount).toBe(1);
        expect(h.stateKeyWrites()).toBe(writes);
        expect(h.events()).toEqual(events);
        h.service.dispose();
    });

    it('explains an already-counted day on the first evaluation of a new session without saving it', async (): Promise<void> => {
        const storage = new MemoryStorage();
        storage.values.set(SURVEY_STATE_KEY, {
            ...EMPTY_SURVEY_STATE,
            lastActiveDay: '2026-10-01',
            activeDayCount: 2,
        });
        const h = createHarness(storage);
        await activity(h);
        expect(trace).toHaveBeenCalledWith('[Survey] Active day already counted: 2 of 3 required.');
        expect(trace).not.toHaveBeenCalledWith('[Survey] Persistence active day: succeeded.');
        expect(h.stateKeyWrites()).toBe(0);
        expect(h.state().activeDayCount).toBe(2);
        h.service.dispose();
    });

    it('traces in-flight coalescing without counting the second milestone', async (): Promise<void> => {
        const h = createHarness();
        const pending = deferred<void>();
        h.storage.update.mockImplementation(async (key, value): Promise<void> => {
            await pending.promise;
            h.storage.write(key, value);
        });
        h.service.recordSurveyActivity('connection');
        h.service.recordSurveyActivity('dataBrowsing');
        expect(trace).toHaveBeenCalledWith('[Survey] Acknowledged usage: dataBrowsing.');
        expect(trace).toHaveBeenCalledWith('[Survey] Skipping evaluation: covered by an in-flight evaluation.');
        pending.resolve();
        await h.service.whenIdle();
        expect(h.state().activeDayCount).toBe(1);
        expect(h.stateKeyWrites()).toBe(1);
        expect(h.sent('survey.eligibility')).toHaveLength(1);
        h.service.dispose();
    });

    it('explains only the actual first blocking sampling gate', async (): Promise<void> => {
        const h = createHarness(undefined, { config: { ...DEFAULT_SURVEY_POLICY_CONFIG, samplingFraction: 0 } });
        await activity(h);
        expect(trace).toHaveBeenCalledWith('[Survey] Not showing invitation: sampling gate blocked.');
        expect(trace).not.toHaveBeenCalledWith('[Survey] Not showing invitation: active-day threshold not reached.');
        expect(h.sent('survey.eligibility')[0].properties.firstBlockingGate).toBe('sampling');
        h.service.dispose();
    });

    it('explains the cooldown deadline and remaining wait locally without adding them or usage counts to telemetry', async (): Promise<void> => {
        const storage = new MemoryStorage();
        seedEligible(storage);
        const now = new Date(2026, 9, 1, 10);
        const deadline = new Date(now.getTime() + 14 * DAY_MS).toISOString();
        storage.values.set(SURVEY_STATE_KEY, {
            ...storage.get<SurveyPersistedState>(SURVEY_STATE_KEY),
            nextEligibleAt: deadline,
        });
        const h = createHarness(storage);
        await activity(h);
        expect(trace).toHaveBeenCalledWith(
            `[Survey] Not showing invitation: cooldown has not expired; eligible after ${deadline}, remaining ${14 * DAY_MS} ms.`,
        );
        expect(h.sent('survey.eligibility')[0].properties.firstBlockingGate).toBe('cooldown');
        const telemetryJson = JSON.stringify(h.sink.mock.calls);
        for (const privateValue of [deadline, 'activeDayCount', 'requiredActiveDays', 'remaining', 'nextEligibleAt']) {
            expect(telemetryJson).not.toContain(privateValue);
        }
        expect(h.sink.mock.calls.every(([event]): boolean => Object.keys(event.measurements).length === 0)).toBe(true);
        h.service.dispose();
    });

    it('distinguishes eligibility, presentation request, visibility, persistence, and session suppression', async (): Promise<void> => {
        const h = createHarness();
        await invite(h);
        expect(trace).toHaveBeenCalledWith('[Survey] Eligible for an invitation.');
        expect(trace).toHaveBeenCalledWith('[Survey] Presentation requested.');
        expect(trace).not.toHaveBeenCalledWith('[Survey] Invitation rendered and visible.');
        h.flags.now = new Date(2026, 9, 4, 10);
        await activity(h);
        expect(trace).toHaveBeenCalledWith(
            '[Survey] Not showing invitation: an invitation was already issued this session.',
        );
        expect(h.sent('survey.eligibility').at(-1)?.properties.firstBlockingGate).toBe('sessionSuppression');
        h.callbacks().onVisible();
        await new Promise<void>((resolve): void => {
            setImmediate(resolve);
        });
        expect(trace).toHaveBeenCalledWith('[Survey] Invitation rendered and visible.');
        expect(trace).toHaveBeenCalledWith('[Survey] Persistence visibility cooldown: succeeded.');
        h.service.dispose();
    });

    it.each(['unregistered', 'unavailable', 'failure'] as const)(
        'explains presentation %s without leaking errors or invitation identifiers',
        async (condition): Promise<void> => {
            const storage = new MemoryStorage();
            seedEligible(storage);
            const h = createHarness(storage);
            if (condition === 'unregistered') {
                h.service.setPresenter(undefined);
            } else if (condition === 'unavailable') {
                h.present.mockResolvedValue(undefined);
            } else {
                h.present.mockRejectedValue(new Error('private-db secret-query'));
            }
            await activity(h);
            expect(trace).toHaveBeenCalledWith(
                condition === 'failure'
                    ? '[Survey] Presentation deferred: presentation failed.'
                    : '[Survey] Presentation deferred: destination unavailable.',
            );
            const output = JSON.stringify(trace.mock.calls);
            expect(output).not.toContain(INVITATION_ID);
            expect(output).not.toContain('private-db');
            expect(output).not.toContain('secret-query');
            expect(h.state().lastOutcome).toBeUndefined();
            h.service.dispose();
        },
    );

    it('traces permission withdrawal without treating programmatic closure as an outcome', async (): Promise<void> => {
        const h = createHarness();
        await invite(h);
        trace.mockClear();
        const events = h.events();
        h.flags.permitted = false;
        h.service.handlePermissionChanged();
        await h.callbacks().onChoice('dismissed');
        expect(trace.mock.calls).toEqual([
            ['[Survey] Feedback permission withdrawn: canceling pending work and invitation.'],
        ]);
        expect(h.state().lastOutcome).toBeUndefined();
        expect(h.events()).toEqual(events);
        h.service.dispose();
    });

    it.each(['opened', 'askLater', 'dismissed', 'neverAgain'] as const)(
        'traces the generic %s outcome and save result without sensitive data',
        async (outcome): Promise<void> => {
            const h = createHarness(undefined, { machineId: 'private-machine-id' });
            await invite(h);
            trace.mockClear();
            if (outcome === 'opened') {
                await h.callbacks().onOpenForm();
            } else {
                await h.callbacks().onChoice(outcome);
            }
            expect(trace).toHaveBeenCalledWith(`[Survey] Invitation outcome: ${outcome}.`);
            expect(trace).toHaveBeenCalledWith(
                `[Survey] Persistence ${outcome === 'neverAgain' ? 'opt-out' : 'invitation outcome'}: succeeded.`,
            );
            const output = JSON.stringify(trace.mock.calls);
            for (const forbidden of [
                'private-machine-id',
                INVITATION_ID,
                SURVEY_FORM_URL,
                'rating',
                'star',
                'elementId',
            ]) {
                expect(output).not.toContain(forbidden);
            }
            h.service.dispose();
        },
    );

    it('traces failed active-day persistence without logging the raw error or preventing evaluation', async (): Promise<void> => {
        const h = createHarness();
        h.storage.update.mockRejectedValueOnce(new Error('mongodb://private-host/private-db?password=secret'));
        await activity(h);
        expect(trace).toHaveBeenCalledWith('[Survey] Persistence active day: failed.');
        expect(trace).toHaveBeenCalledWith('[Survey] Counted a new active day: 1 of 3 required.');
        expect(h.sent('survey.eligibility')).toHaveLength(1);
        expect(JSON.stringify(trace.mock.calls)).not.toContain('secret');
        h.service.dispose();
    });

    it('traces opt-out persistence failure without a save retry', async (): Promise<void> => {
        const reportOptOutSaveFailure = jest.fn<void, []>();
        const h = createHarness(undefined, { reportOptOutSaveFailure });
        await invite(h);
        h.storage.update.mockRejectedValueOnce(new Error('private storage error'));
        await h.callbacks().onChoice('neverAgain');
        expect(trace).toHaveBeenCalledWith('[Survey] Persistence opt-out: failed.');
        expect(reportOptOutSaveFailure).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(trace.mock.calls)).not.toContain('retry');
        expect(JSON.stringify(trace.mock.calls)).not.toContain('private storage error');
        h.service.dispose();
    });

    it('traces command outcome and persistence without transmitting local usage or dates', async (): Promise<void> => {
        const h = createHarness();
        await h.service.openSurveyFormFromCommand();
        expect(trace).toHaveBeenCalledWith('[Survey] Form opening from command: success.');
        expect(trace).toHaveBeenCalledWith('[Survey] Command outcome: opened.');
        expect(trace).toHaveBeenCalledWith('[Survey] Persistence command outcome: succeeded.');
        expect(h.sent('survey.openForm')[0].measurements).toEqual({ attempt: 1 });
        expect(JSON.stringify(h.sink.mock.calls)).not.toContain('activeDayCount');
        expect(JSON.stringify(h.sink.mock.calls)).not.toContain(h.state().nextEligibleAt);
        h.service.dispose();
    });

    it.each(['command', 'invitation'] as const)(
        'traces a generic %s browser failure without exposing raw error details or changing outcomes',
        async (trigger): Promise<void> => {
            const h = createHarness();
            await invite(h);
            trace.mockClear();
            h.openExternal.mockRejectedValue(new Error('private-query mongodb://user:secret@private-host/private-db'));
            const result =
                trigger === 'command' ? await h.service.openSurveyFormFromCommand() : await h.callbacks().onOpenForm();
            expect(result).toBe('failed');
            expect(trace.mock.calls).toEqual([[`[Survey] Form opening from ${trigger}: failure.`]]);
            expect(h.state().lastOutcome).toBeUndefined();
            expect(h.state().nextEligibleAt).toBeUndefined();
            expect(h.sent('survey.invitationResolved')).toHaveLength(0);
            const telemetry = JSON.stringify(h.sink.mock.calls);
            for (const secret of ['private-query', 'mongodb://', 'secret', 'private-host', 'private-db']) {
                expect(telemetry).not.toContain(secret);
            }
            h.service.dispose();
        },
    );

    it('ignores output-channel failures but preserves meaningful reset failures', async (): Promise<void> => {
        trace.mockImplementation((): never => {
            throw new Error('logger unavailable');
        });
        const h = createHarness();
        await invite(h);
        expect(h.state().activeDayCount).toBe(3);
        expect(h.present).toHaveBeenCalledTimes(1);
        const failure = new Error('storage unavailable');
        h.storage.update.mockRejectedValueOnce(failure);
        await expect(h.service.resetState()).rejects.toBe(failure);
        h.service.dispose();
    });
});

describe('survey singleton initialization', (): void => {
    let subscriptions: vscode.Disposable[];
    let originalAlwaysInvite: string | undefined;

    beforeEach((): void => {
        subscriptions = [];
        originalAlwaysInvite = process.env[DEBUG_SURVEY_ALWAYS_INVITE_ENV];
        process.env[DEBUG_SURVEY_ALWAYS_INVITE_ENV] = 'false';
        jest.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue(configuration('all'));
        jest.spyOn(vscode.workspace, 'onDidChangeConfiguration').mockReturnValue({ dispose: jest.fn() });
    });

    afterEach((): void => {
        for (const disposable of subscriptions) {
            disposable.dispose();
        }
        if (originalAlwaysInvite === undefined) {
            delete process.env[DEBUG_SURVEY_ALWAYS_INVITE_ENV];
        } else {
            process.env[DEBUG_SURVEY_ALWAYS_INVITE_ENV] = originalAlwaysInvite;
        }
        jest.restoreAllMocks();
    });

    function context(storage: MemoryStorage, extensionMode: vscode.ExtensionMode): vscode.ExtensionContext {
        return { globalState: storage, subscriptions, extensionMode } as unknown as vscode.ExtensionContext;
    }

    it.each([
        { mode: vscode.ExtensionMode.Production, label: 'Production', writes: 1 },
        { mode: vscode.ExtensionMode.Test, label: 'Test', writes: 1 },
        { mode: vscode.ExtensionMode.Development, label: 'Development', writes: 1 },
    ])('D0021 enables the survey in $label without a launch override', async ({ mode, writes }): Promise<void> => {
        const storage = new MemoryStorage();
        const service = initializeSurveyService(context(storage, mode));
        expect(service.getDebugStatus().enabled).toBe(true);
        expect(service.getDebugStatus().alwaysInvite).toBe(false);
        expect(getSurveyService()).toBe(service);
        expect(initializeSurveyService(context(new MemoryStorage(), mode))).toBe(service);
        expect(subscriptions).toHaveLength(3);
        recordSurveyActivity('connection');
        await service.whenIdle();
        expect(storage.update.mock.calls.filter(([key]): boolean => key === SURVEY_STATE_KEY)).toHaveLength(writes);
    });

    it.each([
        { label: 'eligible', overrides: {}, level: 'all', invitations: 1 },
        { label: 'insufficient active days', overrides: { activeDayCount: 0 }, level: 'all', invitations: 0 },
        {
            label: 'cooldown',
            overrides: { nextEligibleAt: '9999-01-01T00:00:00Z' },
            level: 'all',
            invitations: 0,
        },
        {
            label: 'opt-out',
            overrides: { optedOutAt: '2026-01-01T00:00:00Z' },
            level: 'all',
            invitations: 0,
        },
        { label: 'feedback permission', overrides: {}, level: 'off', invitations: 0 },
    ])('development default respects $label', async ({ overrides, level, invitations }): Promise<void> => {
        jest.mocked(vscode.workspace.getConfiguration).mockReturnValue(configuration(level));
        const storage = new MemoryStorage();
        const state: SurveyPersistedState = { ...EMPTY_SURVEY_STATE, activeDayCount: 2, ...overrides };
        storage.values.set(SURVEY_STATE_KEY, state);
        const service = initializeSurveyService(context(storage, vscode.ExtensionMode.Development));
        const present = jest.fn().mockResolvedValue({ dispose: jest.fn() });
        service.setPresenter({ present });
        recordSurveyActivity('connection');
        await service.whenIdle();
        expect(present).toHaveBeenCalledTimes(invitations);
        if (state.optedOutAt || level !== 'all') {
            expect(storage.update).not.toHaveBeenCalled();
        }
    });

    it.each([vscode.ExtensionMode.Production, vscode.ExtensionMode.Test, vscode.ExtensionMode.Development])(
        'always-invite enables the real service only in development, mode %s',
        async (mode): Promise<void> => {
            process.env[DEBUG_SURVEY_ALWAYS_INVITE_ENV] = 'true';
            jest.mocked(vscode.workspace.getConfiguration).mockReturnValue(configuration('off'));
            const storage = new MemoryStorage();
            storage.values.set(SURVEY_STATE_KEY, {
                ...EMPTY_SURVEY_STATE,
                optedOutAt: '2026-09-30T00:00:00Z',
                nextEligibleAt: '2099-01-01T00:00:00Z',
            });
            const service = initializeSurveyService(context(storage, mode));
            const present = jest.fn().mockResolvedValue({ dispose: jest.fn() });
            service.setPresenter({ present });
            recordSurveyActivity('connection');
            await service.whenIdle();
            expect(present).toHaveBeenCalledTimes(mode === vscode.ExtensionMode.Development ? 1 : 0);
        },
    );

    it('routes configuration changes to withdrawal only for telemetry.telemetryLevel', (): void => {
        const listener = jest.mocked(vscode.workspace.onDidChangeConfiguration);
        const service = initializeSurveyService(context(new MemoryStorage(), vscode.ExtensionMode.Development));
        const handlePermissionChanged = jest.spyOn(service, 'handlePermissionChanged');
        const callback = listener.mock.calls[listener.mock.calls.length - 1][0];
        const unrelated = { affectsConfiguration: jest.fn((): boolean => false) };
        callback(unrelated);
        expect(handlePermissionChanged).not.toHaveBeenCalled();
        const relevant = {
            affectsConfiguration: jest.fn((key: string): boolean => key === 'telemetry.telemetryLevel'),
        };
        callback(relevant);
        expect(relevant.affectsConfiguration).toHaveBeenCalledWith('telemetry.telemetryLevel');
        expect(handlePermissionChanged).toHaveBeenCalledTimes(1);
    });

    it('module activity is a no-op before initialization and guards unexpected service errors', (): void => {
        expect(getSurveyService()).toBeUndefined();
        expect((): void => recordSurveyActivity('connection')).not.toThrow();
        const service = initializeSurveyService(context(new MemoryStorage(), vscode.ExtensionMode.Development));
        jest.spyOn(service, 'recordSurveyActivity').mockImplementation((): never => {
            throw new Error('Unexpected failure');
        });
        expect((): void => recordSurveyActivity('connection')).not.toThrow();
    });
});
