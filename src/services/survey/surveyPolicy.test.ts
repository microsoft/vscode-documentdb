/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    ASK_LATER_COOLDOWN_DAYS,
    DEFAULT_SURVEY_POLICY_CONFIG,
    DISMISSED_COOLDOWN_DAYS,
    OPENED_COOLDOWN_DAYS,
    REQUIRED_ACTIVE_DAYS,
    SAMPLING_FRACTION,
    SURVEY_ENABLED,
} from './surveyConfig';
import {
    computeNextEligibleAt,
    computeSamplingValue,
    evaluateEligibility,
    evaluatePreconditions,
    toLocalDay,
} from './surveyPolicy';
import {
    type SurveyEligibilityInput,
    type SurveyGateId,
    type SurveyGateResult,
    type SurveyPersistedState,
    type SurveyPolicyConfig,
    type SurveyPreconditionId,
    type SurveyPreconditionInput,
    type SurveyTimedOutcome,
} from './surveyTypes';

const NOW = new Date('2026-10-07T12:34:56.789Z');
const MILLISECONDS_PER_DAY = 86_400_000;
const GATE_ORDER = ['sampling', 'activeDays', 'cooldown', 'sessionSuppression'] as const;

function createState(overrides: Partial<SurveyPersistedState> = {}): SurveyPersistedState {
    return {
        version: 1,
        activeDayCount: 0,
        lastActiveDay: undefined,
        lastOutcome: undefined,
        nextEligibleAt: undefined,
        optedOutAt: undefined,
        ...overrides,
    };
}

function createEligibleInput(overrides: Partial<SurveyEligibilityInput> = {}): SurveyEligibilityInput {
    return {
        state: createState({ activeDayCount: REQUIRED_ACTIVE_DAYS }),
        now: NOW,
        samplingValue: 0,
        invitationIssuedThisSession: false,
        ...overrides,
    };
}

describe('evaluatePreconditions', (): void => {
    it('debug always-invite admits disabled, unpermitted, opted-out installations and passes all gates', (): void => {
        expect(
            evaluatePreconditions({
                alwaysInvite: true,
                surveyEnabled: false,
                feedbackPermitted: false,
                optedOut: true,
            }),
        ).toEqual({ admitted: true });
        const result = evaluateEligibility(
            createEligibleInput({
                alwaysInvite: true,
                state: createState({ optedOutAt: NOW.toISOString(), nextEligibleAt: '2099-01-01T00:00:00Z' }),
                samplingValue: 1,
                invitationIssuedThisSession: true,
            }),
            DEFAULT_SURVEY_POLICY_CONFIG,
        );
        expect(result.overall).toBe('eligible');
        expect(result.firstBlockingGate).toBeUndefined();
        expect(result.gates).toEqual(GATE_ORDER.map((gate): SurveyGateResult => ({ gate, status: 'passed' })));
    });

    interface PreconditionCase extends SurveyPreconditionInput {
        readonly failedPrecondition: SurveyPreconditionId | undefined;
    }

    const cases: readonly PreconditionCase[] = [
        { surveyEnabled: false, feedbackPermitted: false, optedOut: false, failedPrecondition: 'killSwitch' },
        { surveyEnabled: false, feedbackPermitted: false, optedOut: true, failedPrecondition: 'killSwitch' },
        { surveyEnabled: false, feedbackPermitted: true, optedOut: false, failedPrecondition: 'killSwitch' },
        { surveyEnabled: false, feedbackPermitted: true, optedOut: true, failedPrecondition: 'killSwitch' },
        { surveyEnabled: true, feedbackPermitted: false, optedOut: false, failedPrecondition: 'feedbackPermission' },
        { surveyEnabled: true, feedbackPermitted: false, optedOut: true, failedPrecondition: 'feedbackPermission' },
        { surveyEnabled: true, feedbackPermitted: true, optedOut: false, failedPrecondition: undefined },
        { surveyEnabled: true, feedbackPermitted: true, optedOut: true, failedPrecondition: 'permanentOptOut' },
    ];

    it.each(cases)(
        'checks kill switch > permission > opt-out for enabled=$surveyEnabled, permitted=$feedbackPermitted, optedOut=$optedOut',
        ({ surveyEnabled, feedbackPermitted, optedOut, failedPrecondition }): void => {
            const result = evaluatePreconditions({ surveyEnabled, feedbackPermitted, optedOut });

            if (failedPrecondition === undefined) {
                expect(result).toEqual({ admitted: true });
            } else {
                expect(result).toEqual({ admitted: false, failedPrecondition });
            }
        },
    );

    it('never admits an opted-out installation regardless of kill switch and permission', (): void => {
        for (const surveyEnabled of [false, true]) {
            for (const feedbackPermitted of [false, true]) {
                expect(evaluatePreconditions({ surveyEnabled, feedbackPermitted, optedOut: true }).admitted).toBe(
                    false,
                );
            }
        }
    });

    it('uses only the opt-out boolean to decide permanent opt-out after the other preconditions pass', (): void => {
        const input: SurveyPreconditionInput = {
            surveyEnabled: true,
            feedbackPermitted: true,
            optedOut: false,
        };

        expect(evaluatePreconditions(input)).toEqual({ admitted: true });
        for (let evaluation = 0; evaluation < 3; evaluation++) {
            expect(evaluatePreconditions({ ...input, optedOut: true })).toEqual({
                admitted: false,
                failedPrecondition: 'permanentOptOut',
            });
        }
        expect(evaluatePreconditions(input)).toEqual({ admitted: true });
    });

    const changedCampaignConfig: SurveyPolicyConfig = {
        ...DEFAULT_SURVEY_POLICY_CONFIG,
        campaignId: 'documentdb-satisfaction-future',
        policyVersion: '99',
    };

    it.each([DEFAULT_SURVEY_POLICY_CONFIG, changedCampaignConfig])(
        'keeps opt-out a precondition, not a gate, for campaign $campaignId and policy $policyVersion',
        (config): void => {
            const state = createState({
                activeDayCount: REQUIRED_ACTIVE_DAYS,
                optedOutAt: '2026-01-01T00:00:00.000Z',
            });

            for (const now of [NOW, new Date('2099-01-01T00:00:00.000Z')]) {
                expect(
                    evaluatePreconditions({
                        surveyEnabled: true,
                        feedbackPermitted: true,
                        optedOut: state.optedOutAt !== undefined,
                    }),
                ).toEqual({ admitted: false, failedPrecondition: 'permanentOptOut' });

                const input = createEligibleInput({ state, now });
                const result = evaluateEligibility(input, config);

                expect(result.overall).toBe('eligible');
                expect(result.firstBlockingGate).toBeUndefined();
                expect(result.gates).toEqual([
                    { gate: 'sampling', status: 'passed' },
                    { gate: 'activeDays', status: 'passed' },
                    { gate: 'cooldown', status: 'passed' },
                    { gate: 'sessionSuppression', status: 'passed' },
                ]);
                expect(result).toEqual(
                    evaluateEligibility({ ...input, state: createState({ ...state, optedOutAt: undefined }) }, config),
                );
            }
        },
    );
});

describe('evaluateEligibility', (): void => {
    it('returns eligible with every gate passed in the exact policy order', (): void => {
        expect(evaluateEligibility(createEligibleInput(), DEFAULT_SURVEY_POLICY_CONFIG)).toEqual({
            overall: 'eligible',
            firstBlockingGate: undefined,
            gates: [
                { gate: 'sampling', status: 'passed' },
                { gate: 'activeDays', status: 'passed' },
                { gate: 'cooldown', status: 'passed' },
                { gate: 'sessionSuppression', status: 'passed' },
            ],
            explanation: {
                activeDayCount: REQUIRED_ACTIVE_DAYS,
                requiredActiveDays: REQUIRED_ACTIVE_DAYS,
                previousOutcome: undefined,
                isReminder: false,
            },
        });
    });

    interface BlockingGateCase {
        readonly gate: SurveyGateId;
        readonly samplingValue: number;
        readonly activeDayCount: number;
        readonly nextEligibleAt: string | undefined;
        readonly invitationIssuedThisSession: boolean;
    }

    const blockingCases: readonly BlockingGateCase[] = [
        {
            gate: 'sampling',
            samplingValue: 0.5,
            activeDayCount: 0,
            nextEligibleAt: '2026-10-08T12:34:56.789Z',
            invitationIssuedThisSession: true,
        },
        {
            gate: 'activeDays',
            samplingValue: 0,
            activeDayCount: 0,
            nextEligibleAt: '2026-10-08T12:34:56.789Z',
            invitationIssuedThisSession: true,
        },
        {
            gate: 'cooldown',
            samplingValue: 0,
            activeDayCount: REQUIRED_ACTIVE_DAYS,
            nextEligibleAt: '2026-10-08T12:34:56.789Z',
            invitationIssuedThisSession: true,
        },
        {
            gate: 'sessionSuppression',
            samplingValue: 0,
            activeDayCount: REQUIRED_ACTIVE_DAYS,
            nextEligibleAt: undefined,
            invitationIssuedThisSession: true,
        },
    ];

    it.each(blockingCases)(
        'stops at $gate, leaving every earlier gate passed and every later gate notEvaluated',
        ({ gate: blockingGate, samplingValue, activeDayCount, nextEligibleAt, invitationIssuedThisSession }): void => {
            const input = createEligibleInput({
                state: createState({ activeDayCount, nextEligibleAt }),
                samplingValue,
                invitationIssuedThisSession,
            });
            const config: SurveyPolicyConfig = { ...DEFAULT_SURVEY_POLICY_CONFIG, samplingFraction: 0.5 };
            const blockedIndex = GATE_ORDER.indexOf(blockingGate);
            const expectedGates = GATE_ORDER.map((gate, index): SurveyGateResult => {
                if (index < blockedIndex) {
                    return { gate, status: 'passed' };
                }
                if (index === blockedIndex) {
                    return { gate, status: 'blocked' };
                }
                return { gate, status: 'notEvaluated' };
            });

            const result = evaluateEligibility(input, config);

            expect(result.overall).toBe('blocked');
            expect(result.firstBlockingGate).toBe(blockingGate);
            expect(result.gates).toEqual(expectedGates);
        },
    );

    describe('sampling', (): void => {
        it.each([
            { samplingValue: 0.249999, expectedStatus: 'passed', expectedOverall: 'eligible' },
            { samplingValue: 0.25, expectedStatus: 'blocked', expectedOverall: 'blocked' },
            { samplingValue: 0.250001, expectedStatus: 'blocked', expectedOverall: 'blocked' },
        ])(
            'uses strict comparison for value $samplingValue at fraction 0.25',
            ({ samplingValue, expectedStatus, expectedOverall }): void => {
                const config: SurveyPolicyConfig = { ...DEFAULT_SURVEY_POLICY_CONFIG, samplingFraction: 0.25 };
                const result = evaluateEligibility(createEligibleInput({ samplingValue }), config);

                expect(result.gates[0]).toEqual({ gate: 'sampling', status: expectedStatus });
                expect(result.overall).toBe(expectedOverall);
            },
        );

        it.each([0, 0.5, 0.999999])('passes value %s when the sampling fraction is 1', (samplingValue): void => {
            const config: SurveyPolicyConfig = { ...DEFAULT_SURVEY_POLICY_CONFIG, samplingFraction: 1 };
            const result = evaluateEligibility(createEligibleInput({ samplingValue }), config);

            expect(result.gates[0]).toEqual({ gate: 'sampling', status: 'passed' });
            expect(result.overall).toBe('eligible');
        });

        it.each([0, 0.5, 0.999999])('blocks value %s when the sampling fraction is 0', (samplingValue): void => {
            const config: SurveyPolicyConfig = { ...DEFAULT_SURVEY_POLICY_CONFIG, samplingFraction: 0 };
            const result = evaluateEligibility(createEligibleInput({ samplingValue }), config);

            expect(result.gates).toEqual([
                { gate: 'sampling', status: 'blocked' },
                { gate: 'activeDays', status: 'notEvaluated' },
                { gate: 'cooldown', status: 'notEvaluated' },
                { gate: 'sessionSuppression', status: 'notEvaluated' },
            ]);
            expect(result.overall).toBe('blocked');
            expect(result.firstBlockingGate).toBe('sampling');
        });
    });

    describe('active days', (): void => {
        it.each([
            { activeDayCount: 0, expectedStatus: 'blocked', expectedOverall: 'blocked' },
            { activeDayCount: 1, expectedStatus: 'blocked', expectedOverall: 'blocked' },
            { activeDayCount: 2, expectedStatus: 'blocked', expectedOverall: 'blocked' },
            { activeDayCount: 3, expectedStatus: 'passed', expectedOverall: 'eligible' },
            { activeDayCount: 10, expectedStatus: 'passed', expectedOverall: 'eligible' },
        ])(
            'checks $activeDayCount active days against the shipped threshold of 3',
            ({ activeDayCount, expectedStatus, expectedOverall }): void => {
                const input = createEligibleInput({ state: createState({ activeDayCount }) });
                const result = evaluateEligibility(input, DEFAULT_SURVEY_POLICY_CONFIG);

                expect(REQUIRED_ACTIVE_DAYS).toBe(3);
                expect(result.gates[1]).toEqual({ gate: 'activeDays', status: expectedStatus });
                expect(result.overall).toBe(expectedOverall);
            },
        );

        it.each([
            { activeDayCount: 4, expectedStatus: 'blocked' },
            { activeDayCount: 5, expectedStatus: 'passed' },
        ])(
            'uses the configured threshold for $activeDayCount active days',
            ({ activeDayCount, expectedStatus }): void => {
                const config: SurveyPolicyConfig = { ...DEFAULT_SURVEY_POLICY_CONFIG, requiredActiveDays: 5 };
                const result = evaluateEligibility(
                    createEligibleInput({ state: createState({ activeDayCount }) }),
                    config,
                );

                expect(result.gates[1]).toEqual({ gate: 'activeDays', status: expectedStatus });
            },
        );
    });

    describe('cooldown', (): void => {
        it.each([
            {
                label: 'missing timestamp',
                nextEligibleAt: undefined,
                expectedStatus: 'passed',
                expectedOverall: 'eligible',
            },
            {
                label: 'future timestamp',
                nextEligibleAt: new Date(NOW.getTime() + 1).toISOString(),
                expectedStatus: 'blocked',
                expectedOverall: 'blocked',
            },
            {
                label: 'timestamp exactly equal to now',
                nextEligibleAt: NOW.toISOString(),
                expectedStatus: 'passed',
                expectedOverall: 'eligible',
            },
            {
                label: 'past timestamp',
                nextEligibleAt: new Date(NOW.getTime() - 1).toISOString(),
                expectedStatus: 'passed',
                expectedOverall: 'eligible',
            },
            {
                label: 'unparseable timestamp',
                nextEligibleAt: 'not-an-iso-timestamp',
                expectedStatus: 'passed',
                expectedOverall: 'eligible',
            },
        ])('handles a $label', ({ nextEligibleAt, expectedStatus, expectedOverall }): void => {
            const input = createEligibleInput({
                state: createState({ activeDayCount: REQUIRED_ACTIVE_DAYS, nextEligibleAt }),
            });
            const result = evaluateEligibility(input, DEFAULT_SURVEY_POLICY_CONFIG);

            expect(result.gates[2]).toEqual({ gate: 'cooldown', status: expectedStatus });
            expect(result.overall).toBe(expectedOverall);
        });
    });

    describe('explanation', (): void => {
        const previousOutcomes: readonly (SurveyTimedOutcome | undefined)[] = [
            undefined,
            'askLater',
            'dismissed',
            'opened',
        ];

        it.each(previousOutcomes)('mirrors previous outcome %p in eligible results', (lastOutcome): void => {
            const config: SurveyPolicyConfig = { ...DEFAULT_SURVEY_POLICY_CONFIG, requiredActiveDays: 7 };
            const input = createEligibleInput({ state: createState({ activeDayCount: 10, lastOutcome }) });
            const result = evaluateEligibility(input, config);

            expect(result.overall).toBe('eligible');
            expect(result.explanation).toEqual({
                activeDayCount: 10,
                requiredActiveDays: 7,
                previousOutcome: lastOutcome,
                isReminder: lastOutcome !== undefined,
            });
        });

        it.each(previousOutcomes)(
            'produces the same input-based explanation when blocked with outcome %p',
            (lastOutcome): void => {
                const config: SurveyPolicyConfig = { ...DEFAULT_SURVEY_POLICY_CONFIG, requiredActiveDays: 7 };
                const input = createEligibleInput({
                    state: createState({ activeDayCount: 2, lastOutcome }),
                    samplingValue: 1,
                });
                const result = evaluateEligibility(input, config);

                expect(result.overall).toBe('blocked');
                expect(result.firstBlockingGate).toBe('sampling');
                expect(result.explanation).toEqual({
                    activeDayCount: 2,
                    requiredActiveDays: 7,
                    previousOutcome: lastOutcome,
                    isReminder: lastOutcome !== undefined,
                });
            },
        );
    });

    it('is eligible with a reminder after an askLater cooldown has elapsed and active days pass', (): void => {
        const state = createState({
            activeDayCount: REQUIRED_ACTIVE_DAYS,
            lastOutcome: 'askLater',
            nextEligibleAt: computeNextEligibleAt(
                'askLater',
                new Date(NOW.getTime() - 15 * MILLISECONDS_PER_DAY),
                DEFAULT_SURVEY_POLICY_CONFIG,
            ).toISOString(),
        });
        const result = evaluateEligibility(createEligibleInput({ state }), DEFAULT_SURVEY_POLICY_CONFIG);

        expect(result.overall).toBe('eligible');
        expect(result.firstBlockingGate).toBeUndefined();
        expect(result.gates).toEqual([
            { gate: 'sampling', status: 'passed' },
            { gate: 'activeDays', status: 'passed' },
            { gate: 'cooldown', status: 'passed' },
            { gate: 'sessionSuppression', status: 'passed' },
        ]);
        expect(result.explanation).toEqual({
            activeDayCount: REQUIRED_ACTIVE_DAYS,
            requiredActiveDays: REQUIRED_ACTIVE_DAYS,
            previousOutcome: 'askLater',
            isReminder: true,
        });
    });
});

describe('toLocalDay', (): void => {
    it('separates 23:59 from 00:00 on the next local calendar day', (): void => {
        const beforeMidnight = toLocalDay(new Date(2026, 9, 7, 23, 59));
        const afterMidnight = toLocalDay(new Date(2026, 9, 8, 0, 0));

        expect(beforeMidnight).toBe('2026-10-07');
        expect(afterMidnight).toBe('2026-10-08');
        expect(beforeMidnight).not.toBe(afterMidnight);
    });

    it('groups 00:00 and 23:59 on the same local calendar day', (): void => {
        expect(toLocalDay(new Date(2026, 9, 7, 0, 0))).toBe('2026-10-07');
        expect(toLocalDay(new Date(2026, 9, 7, 23, 59))).toBe('2026-10-07');
    });

    it('zero-pads the local month and day', (): void => {
        expect(toLocalDay(new Date(2026, 0, 5, 12, 0))).toBe('2026-01-05');
    });

    it('handles local month rollover', (): void => {
        expect(toLocalDay(new Date(2026, 0, 31, 23, 59))).toBe('2026-01-31');
        expect(toLocalDay(new Date(2026, 1, 1, 0, 0))).toBe('2026-02-01');
    });

    it('handles local year rollover from December 31 to January 1', (): void => {
        expect(toLocalDay(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31');
        expect(toLocalDay(new Date(2027, 0, 1, 0, 0))).toBe('2027-01-01');
    });
});

describe('computeNextEligibleAt', (): void => {
    interface CooldownCase {
        readonly outcome: SurveyTimedOutcome;
        readonly days: number;
    }

    const cases: readonly CooldownCase[] = [
        { outcome: 'opened', days: OPENED_COOLDOWN_DAYS },
        { outcome: 'askLater', days: ASK_LATER_COOLDOWN_DAYS },
        { outcome: 'dismissed', days: DISMISSED_COOLDOWN_DAYS },
    ];

    it.each(cases)('adds $days elapsed 24-hour days after $outcome', ({ outcome, days }): void => {
        const nextEligibleAt = computeNextEligibleAt(outcome, NOW, DEFAULT_SURVEY_POLICY_CONFIG);

        expect(nextEligibleAt).toBeInstanceOf(Date);
        expect(nextEligibleAt.getTime()).toBe(NOW.getTime() + days * MILLISECONDS_PER_DAY);
        expect(NOW.toISOString()).toBe('2026-10-07T12:34:56.789Z');
    });

    it('uses the dismissal cooldown independently of the askLater cooldown', (): void => {
        const config: SurveyPolicyConfig = {
            ...DEFAULT_SURVEY_POLICY_CONFIG,
            askLaterCooldownDays: 14,
            dismissedCooldownDays: 5,
        };

        expect(computeNextEligibleAt('dismissed', NOW, config).getTime()).toBe(
            NOW.getTime() + 5 * MILLISECONDS_PER_DAY,
        );
        expect(computeNextEligibleAt('askLater', NOW, config).getTime()).toBe(
            NOW.getTime() + 14 * MILLISECONDS_PER_DAY,
        );
    });

    it('uses elapsed milliseconds across local calendar and daylight-saving boundaries', (): void => {
        const config: SurveyPolicyConfig = {
            ...DEFAULT_SURVEY_POLICY_CONFIG,
            dismissedCooldownDays: 1,
        };

        for (const now of [new Date(2026, 2, 8, 0, 0), new Date(2026, 10, 1, 0, 0)]) {
            expect(computeNextEligibleAt('dismissed', now, config).getTime() - now.getTime()).toBe(
                MILLISECONDS_PER_DAY,
            );
        }
    });
});

describe('shipped survey policy constants', (): void => {
    it('keeps askLater and dismissal at 14 days with their own named constants', (): void => {
        expect(ASK_LATER_COOLDOWN_DAYS).toBe(14);
        expect(DISMISSED_COOLDOWN_DAYS).toBe(14);
        expect(DISMISSED_COOLDOWN_DAYS).toBe(ASK_LATER_COOLDOWN_DAYS);
    });

    it('keeps the opened cooldown at 180 days', (): void => {
        expect(OPENED_COOLDOWN_DAYS).toBe(180);
    });

    it('keeps launch sampling at 1', (): void => {
        expect(SAMPLING_FRACTION).toBe(1);
    });

    it('enables the reintroduced survey through the shared code switch', (): void => {
        expect(SURVEY_ENABLED).toBe(true);
    });
});

describe('computeSamplingValue', (): void => {
    const machineIds = [
        '',
        'documentdb-installation-a',
        'documentdb-installation-b',
        '00000000-0000-0000-0000-000000000000',
        'ffffffff-ffff-ffff-ffff-ffffffffffff',
        'documentdb-installation-\u00e9',
    ];

    it.each(machineIds)('returns the same value for repeated input %p', (machineId): void => {
        const firstValue = computeSamplingValue(machineId);

        expect(computeSamplingValue(machineId)).toBe(firstValue);
        expect(computeSamplingValue(machineId)).toBe(firstValue);
    });

    it.each(machineIds)('returns a value in [0, 1) for input %p', (machineId): void => {
        const value = computeSamplingValue(machineId);

        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
    });

    it('does not assign every different installation the same sampling value', (): void => {
        const values = machineIds.map((machineId): number => computeSamplingValue(machineId));

        expect(new Set(values).size).toBeGreaterThan(1);
    });
});
