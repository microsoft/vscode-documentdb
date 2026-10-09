/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { SurveyService } from '../../services/survey/SurveyService';
import { SURVEY_FORM_URL, SURVEY_STATE_KEY } from '../../services/survey/surveyConfig';
import { EMPTY_SURVEY_STATE } from '../../services/survey/surveyState';
import { SurveyTelemetry, type SurveyTelemetryEvent } from '../../services/survey/surveyTelemetry';
import { type SurveyPersistedState } from '../../services/survey/surveyTypes';
import { GIVE_FEEDBACK_COMMAND, giveFeedback, registerGiveFeedbackCommand } from './giveFeedback';

jest.mock('vscode', (): object => ({
    commands: { registerCommand: jest.fn((): object => ({ dispose: jest.fn() })) },
    window: { showErrorMessage: jest.fn() },
    l10n: { t: (value: string): string => value },
}));
jest.mock('@microsoft/vscode-azext-utils', (): object => ({ callWithTelemetryAndErrorHandling: jest.fn() }));

describe('Give Feedback', (): void => {
    beforeEach((): void => {
        jest.clearAllMocks();
    });

    it.each([true, false])(
        'opens after Never again without clearing it, including enabled=%s',
        async (enabled): Promise<void> => {
            const state: SurveyPersistedState = { ...EMPTY_SURVEY_STATE, optedOutAt: '2026-01-01T00:00:00Z' };
            const update = jest.fn();
            const openExternal = jest.fn().mockResolvedValue(true);
            const events: SurveyTelemetryEvent[] = [];
            const service = new SurveyService({
                storage: {
                    get: <T>(key: string): T | undefined => (key === SURVEY_STATE_KEY ? (state as T) : undefined),
                    update,
                },
                machineId: 'test',
                isSurveyEnabled: (): boolean => enabled,
                isFeedbackPermitted: (): boolean => true,
                openExternal,
                telemetry: new SurveyTelemetry({
                    campaignId: 'test',
                    policyVersion: '1',
                    isPermitted: (): boolean => true,
                    sink: (event): void => {
                        events.push(event);
                    },
                }),
            });
            await giveFeedback(service);
            expect(openExternal).toHaveBeenCalledWith(SURVEY_FORM_URL);
            expect(state.optedOutAt).toBe('2026-01-01T00:00:00Z');
            expect(update).not.toHaveBeenCalled();
            expect(events).toHaveLength(enabled ? 1 : 0);
            service.dispose();
        },
    );

    it('reports a failed opening once in a modal without retrying or recording an outcome', async (): Promise<void> => {
        const events: SurveyTelemetryEvent[] = [];
        const update = jest.fn().mockResolvedValue(undefined);
        const openExternal = jest.fn().mockResolvedValue(false);
        const service = new SurveyService({
            storage: { get: <T>(): T | undefined => undefined, update },
            machineId: 'test',
            isSurveyEnabled: (): boolean => true,
            isFeedbackPermitted: (): boolean => true,
            openExternal,
            telemetry: new SurveyTelemetry({
                campaignId: 'test',
                policyVersion: '1',
                isPermitted: (): boolean => true,
                sink: (event): void => {
                    events.push(event);
                },
            }),
        });
        await giveFeedback(service);
        expect(openExternal).toHaveBeenCalledTimes(1);
        expect(vscode.window.showErrorMessage).toHaveBeenCalledTimes(1);
        expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
            "We couldn't open the survey in your browser. Please try again.",
            { modal: true },
        );
        expect(events.map((event): unknown => [event.properties.openResult, event.measurements.attempt])).toEqual([
            ['failure', 1],
        ]);
        expect(update).not.toHaveBeenCalled();
        service.dispose();
    });

    it.each([
        ['opened', 0],
        ['blocked', 0],
        ['failed', 1],
    ] as const)('makes one attempt and shows %s errors: %i', async (result, errors): Promise<void> => {
        const open = jest.fn().mockResolvedValue(result);
        await giveFeedback({ openSurveyFormFromCommand: open } as unknown as SurveyService);
        expect(open).toHaveBeenCalledTimes(1);
        expect(vscode.window.showErrorMessage).toHaveBeenCalledTimes(errors);
    });

    it('treats a thrown opening as a failure and reports it in a modal', async (): Promise<void> => {
        const open = jest.fn().mockRejectedValue(new Error('boom'));
        await giveFeedback({ openSurveyFormFromCommand: open } as unknown as SurveyService);
        expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.any(String), { modal: true });
    });

    it('registers the contributed command without automatic click or URL telemetry', (): void => {
        const context = { subscriptions: [] } as unknown as vscode.ExtensionContext;
        const service = { openSurveyFormFromCommand: jest.fn() } as unknown as SurveyService;
        registerGiveFeedbackCommand(context, service);
        expect(vscode.commands.registerCommand).toHaveBeenCalledWith(GIVE_FEEDBACK_COMMAND, expect.any(Function));
        expect(context.subscriptions).toHaveLength(1);
    });
});
