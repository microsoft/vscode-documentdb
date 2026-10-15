/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';

import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';

import { isFeedbackPermitted } from '../../utils/feedbackPermission';
import {
    SurveyTelemetry,
    type SurveyDeferralReason,
    type SurveyEligibilityTrigger,
    type SurveyOpenFormTelemetryResult,
    type SurveyTelemetryEvent,
    type SurveyTelemetrySink,
} from './surveyTelemetry';
import {
    SURVEY_FEATURE_AREAS,
    SURVEY_GATE_ORDER,
    type SurveyEligibilityOverall,
    type SurveyEligibilityResult,
    type SurveyFeatureArea,
    type SurveyGateId,
    type SurveyGateResult,
    type SurveyGateStatus,
    type SurveyInvitationOutcome,
    type SurveyOpenFormTrigger,
} from './surveyTypes';

interface FrameworkContext {
    telemetry: {
        properties: Record<string, string>;
        measurements: Record<string, number>;
        suppressIfSuccessful: boolean;
    };
    errorHandling: {
        suppressDisplay: boolean;
        rethrow: boolean;
    };
}

let frameworkContext: FrameworkContext;

vi.mock('@microsoft/vscode-azext-utils', (): object => ({
    callWithTelemetryAndErrorHandling: vi.fn(
        async (_eventName: string, callback: (context: FrameworkContext) => void): Promise<void> => {
            callback(frameworkContext);
        },
    ),
}));

vi.mock('../../utils/feedbackPermission', (): object => ({
    isFeedbackPermitted: vi.fn(),
}));

const INVITATION_ID = '12345678-abcd-4abc-8def-123456789abc';
const OTHER_INVITATION_ID = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
const COMMON_PROPERTIES = {
    surveyCampaignId: 'documentdb-satisfaction-1',
    surveyPolicyVersion: '1',
};
const ELIGIBLE_PROPERTIES = {
    gate_sampling: 'passed',
    gate_activeDays: 'passed',
    gate_cooldown: 'passed',
    gate_sessionSuppression: 'passed',
    overall: 'eligible',
    firstBlockingGate: 'none',
    trigger: 'sessionStart',
};

function createEligibility(overrides: Partial<SurveyEligibilityResult> = {}): SurveyEligibilityResult {
    return {
        gates: SURVEY_GATE_ORDER.map((gate): SurveyGateResult => ({ gate, status: 'passed' })),
        overall: 'eligible',
        firstBlockingGate: undefined,
        explanation: {
            activeDayCount: 23,
            requiredActiveDays: 3,
            previousOutcome: undefined,
            isReminder: false,
        },
        ...overrides,
    };
}

interface EventCase {
    readonly label: string;
    readonly name: string;
    readonly report: (telemetry: SurveyTelemetry) => boolean;
    readonly properties: Readonly<Record<string, string>>;
    readonly measurements: Readonly<Record<string, number>>;
}

const EVENT_CASES: readonly EventCase[] = [
    {
        label: 'cohort entry',
        name: 'survey.cohortEntry',
        report: (telemetry): boolean => telemetry.reportCohortEntry('queryPlayground'),
        properties: { featureArea: 'queryPlayground' },
        measurements: {},
    },
    {
        label: 'eligibility',
        name: 'survey.eligibility',
        report: (telemetry): boolean => telemetry.reportEligibility(createEligibility(), 'sessionStart'),
        properties: ELIGIBLE_PROPERTIES,
        measurements: {},
    },
    {
        label: 'presentation deferral',
        name: 'survey.presentationDeferred',
        report: (telemetry): boolean => telemetry.reportPresentationDeferred('presenterUnavailable'),
        properties: { reason: 'presenterUnavailable' },
        measurements: {},
    },
    {
        label: 'invitation shown',
        name: 'survey.invitationShown',
        report: (telemetry): boolean => telemetry.reportInvitationShown(INVITATION_ID, false),
        properties: { invitationSessionId: INVITATION_ID, isReminder: 'false' },
        measurements: {},
    },
    {
        label: 'invitation form opening',
        name: 'survey.openForm',
        report: (telemetry): boolean => telemetry.reportOpenForm('invitation', 'success', 1, INVITATION_ID),
        properties: { trigger: 'invitation', openResult: 'success', invitationSessionId: INVITATION_ID },
        measurements: { attempt: 1 },
    },
    {
        label: 'command form opening',
        name: 'survey.openForm',
        report: (telemetry): boolean => telemetry.reportOpenForm('command', 'failure', 2, INVITATION_ID),
        properties: { trigger: 'command', openResult: 'failure' },
        measurements: { attempt: 2 },
    },
    {
        label: 'invitation resolution',
        name: 'survey.invitationResolved',
        report: (telemetry): boolean => telemetry.reportInvitationResolved(INVITATION_ID, 'opened', true),
        properties: { invitationSessionId: INVITATION_ID, outcome: 'opened', wasVisible: 'true' },
        measurements: {},
    },
];

describe('SurveyTelemetry', (): void => {
    let permitted: boolean;
    let permission: MockedFunction<() => boolean>;
    let sink: MockedFunction<SurveyTelemetrySink>;
    let telemetry: SurveyTelemetry;

    function createTelemetry(): SurveyTelemetry {
        return new SurveyTelemetry({
            campaignId: COMMON_PROPERTIES.surveyCampaignId,
            policyVersion: COMMON_PROPERTIES.surveyPolicyVersion,
            isPermitted: permission,
            sink,
        });
    }

    beforeEach((): void => {
        vi.clearAllMocks();
        permitted = true;
        permission = vi.fn((): boolean => permitted);
        sink = vi.fn();
        telemetry = createTelemetry();
        frameworkContext = {
            telemetry: { properties: {}, measurements: {}, suppressIfSuccessful: true },
            errorHandling: { suppressDisplay: false, rethrow: true },
        };
        vi.mocked(isFeedbackPermitted).mockReturnValue(false);
    });

    it('attributes a collection tab and a returning invitation through activation and opening', (): void => {
        const collection = { source: 'collectionView', collectionTab: 'queryInsights' } as const;
        const invitation = { source: 'automaticInvitation', invitationKind: 'returning', returnReason: 'askLater' } as const;
        expect(telemetry.reportFeedbackActivated(collection, INVITATION_ID)).toBe(true);
        expect(telemetry.reportFeedbackActivated(collection, INVITATION_ID)).toBe(false);
        expect(telemetry.reportOpenForm('command', 'success', 1, undefined, 4, collection)).toBe(true);
        expect(telemetry.reportFeedbackActivated(invitation, OTHER_INVITATION_ID)).toBe(true);
        expect(telemetry.reportOpenForm('invitation', 'failure', 1, OTHER_INVITATION_ID, undefined, invitation)).toBe(true);
        expect(sink.mock.calls.map(([event]): string => event.name)).toEqual([
            'survey.feedbackActivated', 'survey.openForm', 'survey.feedbackActivated', 'survey.openForm',
        ]);
        expect(sink.mock.calls[0][0].properties).toMatchObject({ activationSource: 'collectionView', collectionTab: 'queryInsights' });
        expect(sink.mock.calls[2][0].properties).toMatchObject({ activationSource: 'automaticInvitation', invitationKind: 'returning', returnReason: 'askLater' });
        expect(sink.mock.calls[3][0].properties).toMatchObject({ activationSource: 'automaticInvitation', invitationKind: 'returning', returnReason: 'askLater' });
    });

    it('rejects invalid provenance and does not spend dedupe budget while permission is off', (): void => {
        expect(telemetry.reportFeedbackActivated({ source: 'clusterDashboard', collectionTab: 'documents' }, INVITATION_ID)).toBe(false);
        expect(telemetry.reportFeedbackActivated({ source: 'automaticInvitation', invitationKind: 'first', returnReason: 'askLater' }, INVITATION_ID)).toBe(false);
        expect(telemetry.reportFeedbackActivated({ source: 'automaticInvitation', invitationKind: 'unknown', returnReason: 'askLater' }, INVITATION_ID)).toBe(false);
        expect(telemetry.reportFeedbackActivated({ source: 'automaticInvitation', invitationKind: 'returning', returnReason: 'unknown' }, INVITATION_ID)).toBe(false);
        expect(telemetry.reportOpenForm('invitation', 'success', 1, INVITATION_ID, undefined, { source: 'giveFeedbackCommand' })).toBe(false);
        permitted = false;
        expect(telemetry.reportFeedbackActivated({ source: 'clusterDashboard' }, INVITATION_ID)).toBe(false);
        permitted = true;
        expect(telemetry.reportFeedbackActivated({ source: 'clusterDashboard' }, INVITATION_ID)).toBe(true);
        expect(sink).toHaveBeenCalledOnce();
    });

    it.each(EVENT_CASES)('emits the exact $label schema with campaign and policy', (eventCase): void => {
        expect(eventCase.report(telemetry)).toBe(true);
        expect(sink).toHaveBeenCalledTimes(1);
        const [event] = sink.mock.calls[0];
        expect(event.name).toBe(eventCase.name);
        expect(event.properties).toEqual({ ...eventCase.properties, ...COMMON_PROPERTIES });
        expect(event.measurements).toEqual(eventCase.measurements);
        expect(Object.values(event.properties).every((value): boolean => !value.includes('http'))).toBe(true);
    });

    it('serializes both boolean values as approved string properties', (): void => {
        for (const value of [false, true]) {
            sink.mockClear();
            const instance = createTelemetry();
            expect(instance.reportInvitationShown(INVITATION_ID, value)).toBe(true);
            expect(instance.reportInvitationResolved(INVITATION_ID, 'dismissed', value)).toBe(true);
            expect(sink.mock.calls.map(([event]): SurveyTelemetryEvent => event)).toEqual([
                {
                    name: 'survey.invitationShown',
                    properties: {
                        ...COMMON_PROPERTIES,
                        invitationSessionId: INVITATION_ID,
                        isReminder: value ? 'true' : 'false',
                    },
                    measurements: {},
                },
                {
                    name: 'survey.invitationResolved',
                    properties: {
                        ...COMMON_PROPERTIES,
                        invitationSessionId: INVITATION_ID,
                        outcome: 'dismissed',
                        wasVisible: value ? 'true' : 'false',
                    },
                    measurements: {},
                },
            ]);
        }
    });

    it.each(EVENT_CASES)('withholds $label until permission is granted without consuming dedupe', (eventCase): void => {
        permitted = false;
        expect(eventCase.report(telemetry)).toBe(false);
        expect(sink).not.toHaveBeenCalled();
        permitted = true;
        expect(eventCase.report(telemetry)).toBe(true);
        expect(permission).toHaveBeenCalledTimes(2);
        expect(sink).toHaveBeenCalledTimes(1);
    });

    it('reads permission again after withdrawal and regrant', (): void => {
        expect(telemetry.reportOpenForm('command', 'success', 1, undefined)).toBe(true);
        permitted = false;
        expect(telemetry.reportOpenForm('command', 'failure', 2, undefined)).toBe(false);
        permitted = true;
        expect(telemetry.reportOpenForm('command', 'failure', 2, undefined)).toBe(true);
        expect(permission).toHaveBeenCalledTimes(3);
        expect(sink).toHaveBeenCalledTimes(2);
    });

    it('fails closed on a throwing permission check without consuming dedupe', (): void => {
        permission.mockImplementation((): never => {
            throw new Error('Settings unavailable');
        });
        for (const eventCase of EVENT_CASES) {
            expect((): void => {
                expect(eventCase.report(telemetry)).toBe(false);
            }).not.toThrow();
        }
        expect(sink).not.toHaveBeenCalled();
        permission.mockImplementation((): boolean => permitted);
        for (const eventCase of EVENT_CASES) {
            expect(eventCase.report(telemetry)).toBe(true);
        }
        expect(sink).toHaveBeenCalledTimes(EVENT_CASES.length);
    });

    it('bounds cohort entry to one successful emission per instance', (): void => {
        permitted = false;
        expect(telemetry.reportCohortEntry('connection')).toBe(false);
        permitted = true;
        expect(telemetry.reportCohortEntry('dataBrowsing')).toBe(true);
        expect(telemetry.reportCohortEntry('connection')).toBe(false);
        expect(telemetry.reportCohortEntry('dataBrowsing')).toBe(false);
        expect(sink).toHaveBeenCalledTimes(1);
    });

    it('accepts every approved feature area', (): void => {
        for (const featureArea of SURVEY_FEATURE_AREAS) {
            expect(createTelemetry().reportCohortEntry(featureArea)).toBe(true);
        }
        expect(sink).toHaveBeenCalledTimes(SURVEY_FEATURE_AREAS.length);
    });

    it('deduplicates eligibility by the last sent statuses and overall only', (): void => {
        const eligible = createEligibility();
        const blocked = createEligibility({
            gates: [
                { gate: 'sampling', status: 'passed' },
                { gate: 'activeDays', status: 'blocked' },
                { gate: 'cooldown', status: 'notEvaluated' },
                { gate: 'sessionSuppression', status: 'notEvaluated' },
            ],
            overall: 'blocked',
            firstBlockingGate: 'activeDays',
        });
        expect(telemetry.reportEligibility(eligible, 'sessionStart')).toBe(true);
        expect(telemetry.reportEligibility(eligible, 'stateChange')).toBe(false);
        expect(
            telemetry.reportEligibility(
                createEligibility({
                    explanation: {
                        activeDayCount: 99,
                        requiredActiveDays: 5,
                        previousOutcome: 'askLater',
                        isReminder: true,
                    },
                }),
                'newActiveDay',
            ),
        ).toBe(false);
        expect(telemetry.reportEligibility(blocked, 'newActiveDay')).toBe(true);
        expect(telemetry.reportEligibility(blocked, 'stateChange')).toBe(false);
        expect(telemetry.reportEligibility(eligible, 'stateChange')).toBe(true);
        expect(sink.mock.calls.map(([event]): SurveyTelemetryEvent => event)).toEqual([
            {
                name: 'survey.eligibility',
                properties: { ...COMMON_PROPERTIES, ...ELIGIBLE_PROPERTIES },
                measurements: {},
            },
            {
                name: 'survey.eligibility',
                properties: {
                    ...COMMON_PROPERTIES,
                    gate_sampling: 'passed',
                    gate_activeDays: 'blocked',
                    gate_cooldown: 'notEvaluated',
                    gate_sessionSuppression: 'notEvaluated',
                    overall: 'blocked',
                    firstBlockingGate: 'activeDays',
                    trigger: 'newActiveDay',
                },
                measurements: {},
            },
            {
                name: 'survey.eligibility',
                properties: { ...COMMON_PROPERTIES, ...ELIGIBLE_PROPERTIES, trigger: 'stateChange' },
                measurements: {},
            },
        ]);
    });

    it('recognizes independent status and overall changes and ignores gate array ordering', (): void => {
        const eligible = createEligibility();
        expect(telemetry.reportEligibility(eligible, 'sessionStart')).toBe(true);
        expect(
            telemetry.reportEligibility(createEligibility({ gates: [...eligible.gates].reverse() }), 'stateChange'),
        ).toBe(false);
        const changedStatus = createEligibility({
            gates: eligible.gates.map(
                (gate): SurveyGateResult => (gate.gate === 'cooldown' ? { ...gate, status: 'blocked' } : gate),
            ),
        });
        expect(telemetry.reportEligibility(changedStatus, 'stateChange')).toBe(true);
        expect(telemetry.reportEligibility({ ...changedStatus, overall: 'blocked' }, 'stateChange')).toBe(true);
        expect(sink).toHaveBeenCalledTimes(3);
    });

    it('does not consume eligibility changes withheld while permission is withdrawn', (): void => {
        expect(telemetry.reportEligibility(createEligibility(), 'sessionStart')).toBe(true);
        const changed = createEligibility({ overall: 'blocked' });
        permitted = false;
        expect(telemetry.reportEligibility(changed, 'stateChange')).toBe(false);
        permitted = true;
        expect(telemetry.reportEligibility(changed, 'stateChange')).toBe(true);
        expect(telemetry.reportEligibility(changed, 'newActiveDay')).toBe(false);
        expect(sink).toHaveBeenCalledTimes(2);
    });

    it('deduplicates changed deferral reasons and resets only after a sent invitation', (): void => {
        expect(telemetry.reportPresentationDeferred('presenterUnavailable')).toBe(true);
        expect(telemetry.reportPresentationDeferred('presenterUnavailable')).toBe(false);
        expect(telemetry.reportPresentationDeferred('presentationFailed')).toBe(true);
        expect(telemetry.reportPresentationDeferred('presentationFailed')).toBe(false);
        permitted = false;
        expect(telemetry.reportInvitationShown(INVITATION_ID, false)).toBe(false);
        permitted = true;
        expect(telemetry.reportPresentationDeferred('presentationFailed')).toBe(false);
        expect(telemetry.reportInvitationShown(INVITATION_ID, false)).toBe(true);
        expect(telemetry.reportPresentationDeferred('presentationFailed')).toBe(true);
        expect(telemetry.reportInvitationShown(INVITATION_ID, false)).toBe(false);
        expect(telemetry.reportPresentationDeferred('presentationFailed')).toBe(false);
        expect(telemetry.reportPresentationDeferred('presenterUnavailable')).toBe(true);
        expect(sink).toHaveBeenCalledTimes(5);
    });

    it('bounds invitation shown and resolved independently to once per id', (): void => {
        for (const id of [INVITATION_ID, OTHER_INVITATION_ID]) {
            expect(telemetry.reportInvitationShown(id, false)).toBe(true);
            expect(telemetry.reportInvitationShown(id, true)).toBe(false);
            expect(telemetry.reportInvitationResolved(id, 'opened', true)).toBe(true);
            expect(telemetry.reportInvitationResolved(id, 'neverAgain', false)).toBe(false);
        }
        expect(sink).toHaveBeenCalledTimes(4);
    });

    it('accepts uppercase UUID strings', (): void => {
        const id = INVITATION_ID.toUpperCase();
        expect(telemetry.reportInvitationShown(id, true)).toBe(true);
        expect(telemetry.reportInvitationResolved(id, 'askLater', true)).toBe(true);
        expect(telemetry.reportOpenForm('invitation', 'success', 1, id)).toBe(true);
        expect(sink).toHaveBeenCalledTimes(3);
    });

    it('sends every valid form attempt without deduplicating repeated attempts', (): void => {
        for (const attempt of [1, 2, 3, 1]) {
            expect(telemetry.reportOpenForm('invitation', 'failure', attempt, INVITATION_ID)).toBe(true);
            const [event] = sink.mock.calls[sink.mock.calls.length - 1];
            expect(event.properties).toEqual({
                ...COMMON_PROPERTIES,
                trigger: 'invitation',
                openResult: 'failure',
                invitationSessionId: INVITATION_ID,
            });
            expect(event.measurements).toEqual({ attempt });
        }
        expect(sink).toHaveBeenCalledTimes(4);
    });

    it('rejects form attempts outside the integer range 1 through 3', (): void => {
        for (const attempt of [0, 4, 1.5, NaN, -1, Infinity]) {
            expect(telemetry.reportOpenForm('invitation', 'success', attempt, INVITATION_ID)).toBe(false);
            expect(telemetry.reportOpenForm('command', 'success', attempt, undefined)).toBe(false);
        }
        expect(sink).not.toHaveBeenCalled();
    });

    it.each([1, 2, 3, 4, 5])('reports selected rating %i as an invitation opening measurement', (rating): void => {
        expect(telemetry.reportOpenForm('invitation', 'success', 1, INVITATION_ID, rating)).toBe(true);
        expect(sink.mock.calls[0][0].measurements).toEqual({ attempt: 1, selectedRating: rating });
        expect(sink.mock.calls[0][0].properties).not.toHaveProperty('selectedRating');
    });

    it('omits an unselected rating instead of reporting zero or an undefined field', (): void => {
        expect(telemetry.reportOpenForm('invitation', 'failure', 1, INVITATION_ID, undefined)).toBe(true);
        expect(sink.mock.calls[0][0].measurements).toEqual({ attempt: 1 });
        expect(sink.mock.calls[0][0].measurements).not.toHaveProperty('selectedRating');
    });

    it('rejects invalid ratings on invitation and manual openings', (): void => {
        for (const rating of [0, 6, -1, 1.5, NaN, Infinity, null, '5', { value: 5 }, [5]]) {
            expect(telemetry.reportOpenForm('invitation', 'success', 1, INVITATION_ID, rating)).toBe(false);
            expect(telemetry.reportOpenForm('command', 'success', 1, undefined, rating)).toBe(false);
        }
        expect(telemetry.reportOpenForm('invitation', 'success', 4, INVITATION_ID, 5)).toBe(false);
        expect(sink).not.toHaveBeenCalled();
    });

    it('reports an optional rating from a manually opened sidebar without an invitation id', (): void => {
        expect(telemetry.reportOpenForm('command', 'success', 1, undefined, 4)).toBe(true);
        expect(sink.mock.calls[0][0].properties).toEqual({
            ...COMMON_PROPERTIES,
            trigger: 'command',
            openResult: 'success',
        });
        expect(sink.mock.calls[0][0].measurements).toEqual({ attempt: 1, selectedRating: 4 });
    });

    it('never emits eligibility explanation fields or the active-day count', (): void => {
        const result = createEligibility({
            explanation: {
                activeDayCount: 987654,
                requiredActiveDays: 789,
                previousOutcome: 'askLater',
                isReminder: true,
            },
        });
        expect(telemetry.reportEligibility(result, 'sessionStart')).toBe(true);
        const [event] = sink.mock.calls[0];
        expect(event.properties).toEqual({ ...COMMON_PROPERTIES, ...ELIGIBLE_PROPERTIES });
        expect(event.measurements).toEqual({});
        for (const key of Object.keys(result.explanation)) {
            expect(event.properties).not.toHaveProperty(key);
            expect(event.measurements).not.toHaveProperty(key);
        }
        expect(JSON.stringify(event)).not.toContain('987654');
    });

    it('ignores invitation ids on command form events, including URLs', (): void => {
        for (const id of [INVITATION_ID, 'https://aka.ms/DocumentDBSurvey', '3', undefined]) {
            expect(telemetry.reportOpenForm('command', 'success', 1, id)).toBe(true);
        }
        for (const [event] of sink.mock.calls) {
            expect(event.name).toBe('survey.openForm');
            expect(event.properties).toEqual({ ...COMMON_PROPERTIES, trigger: 'command', openResult: 'success' });
            expect(event.measurements).toEqual({ attempt: 1 });
            expect(Object.values(event.properties).every((value): boolean => !value.includes('http'))).toBe(true);
        }
    });

    it('rejects unapproved feature areas and non-UUID invitation ids', (): void => {
        expect(telemetry.reportCohortEntry('https://aka.ms/DocumentDBSurvey' as unknown as SurveyFeatureArea)).toBe(
            false,
        );
        for (const id of ['https://aka.ms/DocumentDBSurvey', '3', '', `${INVITATION_ID}\n`]) {
            expect(telemetry.reportInvitationShown(id, false)).toBe(false);
            expect(telemetry.reportInvitationResolved(id, 'opened', true)).toBe(false);
            expect(telemetry.reportOpenForm('invitation', 'success', 1, id)).toBe(false);
        }
        expect(telemetry.reportOpenForm('invitation', 'success', 1, undefined)).toBe(false);
        expect(sink).not.toHaveBeenCalled();
        expect(telemetry.reportCohortEntry('connection')).toBe(true);
    });

    it('rejects unknown trigger, reason, outcome, and openResult vocabularies', (): void => {
        const unknownValue = 'https://aka.ms/DocumentDBSurvey';
        expect(
            telemetry.reportEligibility(createEligibility(), unknownValue as unknown as SurveyEligibilityTrigger),
        ).toBe(false);
        expect(telemetry.reportPresentationDeferred(unknownValue as unknown as SurveyDeferralReason)).toBe(false);
        expect(
            telemetry.reportInvitationResolved(INVITATION_ID, unknownValue as unknown as SurveyInvitationOutcome, true),
        ).toBe(false);
        expect(
            telemetry.reportOpenForm(unknownValue as unknown as SurveyOpenFormTrigger, 'success', 1, INVITATION_ID),
        ).toBe(false);
        expect(
            telemetry.reportOpenForm(
                'invitation',
                unknownValue as unknown as SurveyOpenFormTelemetryResult,
                1,
                INVITATION_ID,
            ),
        ).toBe(false);
        expect(sink).not.toHaveBeenCalled();
    });

    it('rejects missing, duplicate, extra, unknown, or invalid-status gates', (): void => {
        const gates = createEligibility().gates;
        const malformedGates: readonly (readonly SurveyGateResult[])[] = [
            gates.slice(1),
            [gates[0], undefined, gates[2], gates[3]] as unknown as readonly SurveyGateResult[],
            [gates[0], gates[0], gates[2], gates[3]],
            [...gates, gates[0]],
            [{ gate: 'unknown' as unknown as SurveyGateId, status: 'passed' }, ...gates.slice(1)],
            [{ gate: 'sampling', status: 'unknown' as unknown as SurveyGateStatus }, ...gates.slice(1)],
        ];
        for (const invalidGates of malformedGates) {
            expect(telemetry.reportEligibility(createEligibility({ gates: invalidGates }), 'sessionStart')).toBe(false);
        }
        expect(sink).not.toHaveBeenCalled();
        expect(telemetry.reportEligibility(createEligibility(), 'sessionStart')).toBe(true);
    });

    it('rejects unapproved overall and first-blocking-gate values', (): void => {
        expect(
            telemetry.reportEligibility(
                createEligibility({ overall: 'unknown' as unknown as SurveyEligibilityOverall }),
                'sessionStart',
            ),
        ).toBe(false);
        expect(
            telemetry.reportEligibility(
                createEligibility({ firstBlockingGate: 'https://aka.ms/DocumentDBSurvey' as unknown as SurveyGateId }),
                'sessionStart',
            ),
        ).toBe(false);
        expect(sink).not.toHaveBeenCalled();
    });

    it.each(EVENT_CASES)('contains a throwing sink for $label without consuming dedupe', (eventCase): void => {
        sink.mockImplementationOnce((): never => {
            throw new Error('Telemetry unavailable');
        });
        expect((): void => {
            expect(eventCase.report(telemetry)).toBe(false);
        }).not.toThrow();
        expect(eventCase.report(telemetry)).toBe(true);
        expect(sink).toHaveBeenCalledTimes(2);
    });

    it('does not clear the deferral reason when the invitation sink throws', (): void => {
        expect(telemetry.reportPresentationDeferred('presentationFailed')).toBe(true);
        sink.mockImplementationOnce((): never => {
            throw new Error('Telemetry unavailable');
        });
        expect(telemetry.reportInvitationShown(INVITATION_ID, false)).toBe(false);
        expect(telemetry.reportPresentationDeferred('presentationFailed')).toBe(false);
        expect(telemetry.reportInvitationShown(INVITATION_ID, false)).toBe(true);
        expect(telemetry.reportPresentationDeferred('presentationFailed')).toBe(true);
    });

    it('uses the default framework sink with silent errors and successful events enabled', (): void => {
        const instance = new SurveyTelemetry({
            campaignId: COMMON_PROPERTIES.surveyCampaignId,
            policyVersion: COMMON_PROPERTIES.surveyPolicyVersion,
            isPermitted: (): boolean => true,
        });
        expect(instance.reportOpenForm('invitation', 'success', 3, INVITATION_ID)).toBe(true);
        expect(callWithTelemetryAndErrorHandling).toHaveBeenCalledTimes(1);
        expect(callWithTelemetryAndErrorHandling).toHaveBeenCalledWith('survey.openForm', expect.any(Function));
        expect(frameworkContext).toEqual({
            telemetry: {
                properties: {
                    ...COMMON_PROPERTIES,
                    trigger: 'invitation',
                    openResult: 'success',
                    invitationSessionId: INVITATION_ID,
                },
                measurements: { attempt: 3 },
                suppressIfSuccessful: false,
            },
            errorHandling: { suppressDisplay: true, rethrow: false },
        });
    });

    it('reads the default feedback permission on each emission', (): void => {
        const instance = new SurveyTelemetry({
            campaignId: COMMON_PROPERTIES.surveyCampaignId,
            policyVersion: COMMON_PROPERTIES.surveyPolicyVersion,
            sink,
        });
        const feedbackPermission = vi.mocked(isFeedbackPermitted);
        expect(instance.reportCohortEntry('connection')).toBe(false);
        feedbackPermission.mockReturnValue(true);
        expect(instance.reportCohortEntry('connection')).toBe(true);
        feedbackPermission.mockReturnValue(false);
        expect(instance.reportInvitationShown(INVITATION_ID, false)).toBe(false);
        feedbackPermission.mockReturnValue(true);
        expect(instance.reportInvitationShown(INVITATION_ID, false)).toBe(true);
        expect(feedbackPermission).toHaveBeenCalledTimes(4);
        expect(sink).toHaveBeenCalledTimes(2);
    });

    it('swallows rejected framework promises from the default sink', async (): Promise<void> => {
        vi.mocked(callWithTelemetryAndErrorHandling).mockRejectedValueOnce(new Error('Telemetry unavailable'));
        const instance = new SurveyTelemetry({
            campaignId: COMMON_PROPERTIES.surveyCampaignId,
            policyVersion: COMMON_PROPERTIES.surveyPolicyVersion,
            isPermitted: (): boolean => true,
        });
        expect(instance.reportCohortEntry('connection')).toBe(true);
        await Promise.resolve();
        expect(callWithTelemetryAndErrorHandling).toHaveBeenCalledTimes(1);
    });
});
