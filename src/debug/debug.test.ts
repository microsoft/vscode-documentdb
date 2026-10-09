/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as packageJson from '../../package.json';
import { getSurveyService, recordSurveyActivity, type SurveyService } from '../services/survey/SurveyService';
import { DEBUG_SURVEY_ALWAYS_INVITE_ENV, readDebugOverrides } from './debugOverrides';
import {
    DEVELOPMENT_MODE_CONTEXT,
    registerDebugCommands,
    RESET_SURVEY_STATE_COMMAND,
    SHOW_SURVEY_INVITATION_COMMAND,
    SIMULATE_SURVEY_MILESTONE_COMMAND,
} from './registerDebugCommands';

jest.mock('vscode', (): object => ({
    ExtensionMode: { Production: 1, Development: 2, Test: 3 },
    commands: {
        executeCommand: jest.fn().mockResolvedValue(undefined),
        registerCommand: jest.fn((): object => ({ dispose: jest.fn() })),
    },
    window: { showInformationMessage: jest.fn(), showWarningMessage: jest.fn() },
}));
jest.mock('../services/survey/SurveyService', (): object => ({
    getSurveyService: jest.fn(),
    recordSurveyActivity: jest.fn(),
}));

beforeEach((): void => {
    jest.clearAllMocks();
    jest.replaceProperty(process, 'env', {
        ...process.env,
        [DEBUG_SURVEY_ALWAYS_INVITE_ENV]: 'true',
    });
});

afterEach((): void => {
    jest.restoreAllMocks();
});

it.each([vscode.ExtensionMode.Production, vscode.ExtensionMode.Test])(
    'ignores overrides and registers no debug commands in mode %s',
    async (extensionMode): Promise<void> => {
        expect(readDebugOverrides(extensionMode)).toEqual({ surveyAlwaysInvite: false });
        const context = { extensionMode, subscriptions: [] } as unknown as vscode.ExtensionContext;
        await registerDebugCommands(context);
        expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
        expect(vscode.commands.registerCommand).not.toHaveBeenCalled();
        expect(context.subscriptions).toHaveLength(0);
    },
);

it('reads development overrides and enables always-invite only for the exact value true', (): void => {
    expect(readDebugOverrides(vscode.ExtensionMode.Development)).toEqual({
        surveyAlwaysInvite: true,
    });
    for (const value of ['false', 'TRUE', '1', '']) {
        process.env[DEBUG_SURVEY_ALWAYS_INVITE_ENV] = value;
        expect(readDebugOverrides(vscode.ExtensionMode.Development).surveyAlwaysInvite).toBe(false);
    }
    delete process.env[DEBUG_SURVEY_ALWAYS_INVITE_ENV];
    expect(readDebugOverrides(vscode.ExtensionMode.Development)).toEqual({
        surveyAlwaysInvite: false,
    });
});

it('registers development commands that use the real milestone entry point and service reset', async (): Promise<void> => {
    const resetState = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
    const whenIdle = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
    const showInvitationForDebug = jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined);
    const getDebugStatus = jest.fn().mockReturnValue({
        alwaysInvite: false,
        enabled: false,
        feedbackPermitted: true,
        optedOut: false,
        presenterRegistered: true,
        invitationActive: false,
    });
    jest.mocked(getSurveyService).mockReturnValue({
        resetState,
        whenIdle,
        getDebugStatus,
        showInvitationForDebug,
    } as unknown as SurveyService);
    const context = {
        extensionMode: vscode.ExtensionMode.Development,
        subscriptions: [],
    } as unknown as vscode.ExtensionContext;
    await registerDebugCommands(context);
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('setContext', DEVELOPMENT_MODE_CONTEXT, true);
    expect(context.subscriptions).toHaveLength(3);
    const registrations = jest.mocked(vscode.commands.registerCommand).mock.calls;
    expect(registrations.map(([command]): string => command)).toEqual([
        SHOW_SURVEY_INVITATION_COMMAND,
        SIMULATE_SURVEY_MILESTONE_COMMAND,
        RESET_SURVEY_STATE_COMMAND,
    ]);
    await registrations[0][1]();
    expect(showInvitationForDebug).toHaveBeenCalledWith('connection');
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringMatching(/^Survey invitation NOT shown\. alwaysInvite=false, enabled=false/),
    );
    await registrations[1][1]();
    expect(recordSurveyActivity).toHaveBeenCalledWith('connection');
    expect(whenIdle).toHaveBeenCalled();
    await registrations[2][1]();
    expect(resetState).toHaveBeenCalledTimes(1);
});

it('contributes uncategorized underscore titles and development-only palette entries', (): void => {
    for (const command of [
        SHOW_SURVEY_INVITATION_COMMAND,
        SIMULATE_SURVEY_MILESTONE_COMMAND,
        RESET_SURVEY_STATE_COMMAND,
    ]) {
        const contribution = packageJson.contributes.commands.find((entry): boolean => entry.command === command);
        expect(contribution?.title).toMatch(/^_DocumentDB: Survey: /);
        expect(contribution).not.toHaveProperty('category');
        expect(packageJson.contributes.menus.commandPalette).toContainEqual({
            command,
            when: DEVELOPMENT_MODE_CONTEXT,
        });
    }
});
