/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readFileSync } from 'fs';
import { resolve } from 'path';
import * as vscode from 'vscode';
import { SurveyService } from '../../services/survey/SurveyService';
import { SURVEY_FORM_URL, SURVEY_STATE_KEY } from '../../services/survey/surveyConfig';
import { type SurveyInvitationCallbacks, type SurveyInvitationRequest } from '../../services/survey/surveyPresentation';
import { EMPTY_SURVEY_STATE } from '../../services/survey/surveyState';
import { SurveyTelemetry, type SurveyTelemetryEvent } from '../../services/survey/surveyTelemetry';
import { type SurveyPersistedState } from '../../services/survey/surveyTypes';
import { isFeedbackPermitted } from '../../utils/feedbackPermission';
import {
    GIVE_FEEDBACK_COMMAND,
    GIVE_FEEDBACK_VIEW_COMMAND,
    giveFeedback,
    registerGiveFeedbackCommand,
    showFeedbackView,
} from './giveFeedback';

vi.mock('vscode', (): object => ({
    commands: { registerCommand: vi.fn((): object => ({ dispose: vi.fn() })) },
    window: { showErrorMessage: vi.fn() },
    env: { openExternal: vi.fn() },
    Uri: { parse: (value: string): string => value },
    l10n: { t: (value: string): string => value },
}));
vi.mock('@microsoft/vscode-azext-utils', (): object => ({ callWithTelemetryAndErrorHandling: vi.fn() }));
vi.mock('../../utils/feedbackPermission', (): object => ({ isFeedbackPermitted: vi.fn() }));

describe('Give Feedback', (): void => {
    beforeEach((): void => {
        vi.clearAllMocks();
        vi.mocked(isFeedbackPermitted).mockReturnValue(true);
    });

    it.each([true, false])(
        'opens the feedback sidebar after Never again without clearing it, including enabled=%s',
        async (enabled): Promise<void> => {
            const state: SurveyPersistedState = { ...EMPTY_SURVEY_STATE, optedOutAt: '2026-01-01T00:00:00Z' };
            const update = vi.fn();
            const openExternal = vi.fn().mockResolvedValue(true);
            const events: SurveyTelemetryEvent[] = [];
            const present = vi
                .fn<(...args: [SurveyInvitationRequest, SurveyInvitationCallbacks]) => Promise<vscode.Disposable>>()
                .mockResolvedValue({ dispose: vi.fn() });
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
            service.setPresenter({ present });
            await giveFeedback(service);
            expect(present).toHaveBeenCalledOnce();
            const [request, callbacks] = present.mock.calls[0];
            expect(request.manuallyOpened).toBe(true);
            expect(openExternal).not.toHaveBeenCalled();
            callbacks.onVisible();
            expect(await callbacks.onOpenForm(5)).toBe('opened');
            expect(openExternal).toHaveBeenCalledWith(SURVEY_FORM_URL);
            expect(state.optedOutAt).toBe('2026-01-01T00:00:00Z');
            expect(update).not.toHaveBeenCalled();
            expect(events.map((event): string => event.name)).toEqual(
                enabled ? ['survey.feedbackActivated', 'survey.openForm'] : [],
            );
            expect(events.every((event): boolean => event.properties.activationSource === 'giveFeedbackCommand')).toBe(
                true,
            );
            service.dispose();
        },
    );

    it.each([true, false])('opens the feedback sidebar from the command, shown=%s', async (shown): Promise<void> => {
        const open = vi.fn().mockResolvedValue(shown);
        await giveFeedback({ showFeedbackForm: open } as unknown as SurveyService);
        expect(open).toHaveBeenCalledExactlyOnceWith('giveFeedbackCommand');
        expect(vscode.window.showErrorMessage).toHaveBeenCalledTimes(shown ? 0 : 1);
    });

    it('treats a thrown presentation as a failure', async (): Promise<void> => {
        const open = vi.fn().mockRejectedValue(new Error('boom'));
        await giveFeedback({ showFeedbackForm: open } as unknown as SurveyService);
        expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
            "We couldn't open the feedback view. Please try again.",
        );
    });

    it.each([true, false])(
        'opens the survey in the browser when the survey service is unavailable, opened=%s',
        async (opened): Promise<void> => {
            vi.mocked(vscode.env.openExternal).mockResolvedValue(opened);
            await giveFeedback(undefined);
            expect(vscode.env.openExternal).toHaveBeenCalledWith(SURVEY_FORM_URL);
            expect(vscode.window.showErrorMessage).toHaveBeenCalledTimes(opened ? 0 : 1);
        },
    );

    it('does nothing from a keybinding or stale invocation when feedback is off', async (): Promise<void> => {
        vi.mocked(isFeedbackPermitted).mockReturnValue(false);
        const open = vi.fn();
        await giveFeedback({ showFeedbackForm: open } as unknown as SurveyService);
        expect(open).not.toHaveBeenCalled();
        expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    });

    it('hides the command from the Command Palette when telemetry.feedback.enabled is off', (): void => {
        const manifest = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
            contributes: { menus: { commandPalette: { command: string; when?: string }[] } };
        };
        const entry = manifest.contributes.menus.commandPalette.find(
            (item): boolean => item.command === GIVE_FEEDBACK_COMMAND,
        );
        expect(entry?.when).toBe('config.telemetry.feedback.enabled');
    });

    it.each([true, false])('opens the feedback sidebar from the tree, shown=%s', async (shown): Promise<void> => {
        const open = vi.fn().mockResolvedValue(shown);
        await showFeedbackView({ showFeedbackForm: open } as unknown as SurveyService);
        expect(open).toHaveBeenCalledExactlyOnceWith('helpAndFeedbackView');
        expect(vscode.window.showErrorMessage).toHaveBeenCalledTimes(shown ? 0 : 1);
    });

    it('does not open feedback from a stale tree item when permission is off', async (): Promise<void> => {
        vi.mocked(isFeedbackPermitted).mockReturnValue(false);
        const open = vi.fn();
        await showFeedbackView({ showFeedbackForm: open } as unknown as SurveyService);
        expect(open).not.toHaveBeenCalled();
        expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    });

    it('registers the contributed command without automatic click or URL telemetry', (): void => {
        const context = { subscriptions: [] } as unknown as vscode.ExtensionContext;
        const service = { openSurveyFormFromCommand: vi.fn(), showFeedbackForm: vi.fn() } as unknown as SurveyService;
        registerGiveFeedbackCommand(context, service);
        expect(vscode.commands.registerCommand).toHaveBeenCalledWith(GIVE_FEEDBACK_COMMAND, expect.any(Function));
        expect(vscode.commands.registerCommand).toHaveBeenCalledWith(GIVE_FEEDBACK_VIEW_COMMAND, expect.any(Function));
        expect(context.subscriptions).toHaveLength(2);
    });
});
