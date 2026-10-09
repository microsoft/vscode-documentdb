/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { GIVE_FEEDBACK_COMMAND } from './commands/giveFeedback/giveFeedback';
import { activateInternal } from './extension';
import { initializeSurveyService } from './services/survey/SurveyService';
import { SURVEY_FORM_URL } from './services/survey/surveyConfig';

jest.mock('vscode', (): object => ({
    ExtensionMode: { Production: 1, Development: 2, Test: 3 },
    commands: { registerCommand: jest.fn((): object => ({ dispose: jest.fn() })) },
    window: { createOutputChannel: jest.fn(), registerUriHandler: jest.fn(), showErrorMessage: jest.fn() },
    workspace: { registerTextDocumentContentProvider: jest.fn(), getConfiguration: (): object => ({ get: jest.fn() }) },
    env: { openExternal: jest.fn().mockResolvedValue(true) },
    Uri: { parse: (value: string): string => value },
    l10n: { t: (value: string): string => value },
}));
jest.mock('@microsoft/vscode-azext-azureutils', (): object => ({ registerAzureUtilsExtensionVariables: jest.fn() }));
jest.mock('@microsoft/vscode-azext-utils', (): object => ({
    TreeElementStateManager: jest.fn(),
    createAzExtLogOutputChannel: (): object => ({ error: jest.fn() }),
    registerUIExtensionVariables: jest.fn(),
    registerErrorHandler: jest.fn(),
    createApiProvider: jest.fn(),
    callWithTelemetryAndErrorHandling: async (
        _name: string,
        callback: (context: object) => Promise<void>,
    ): Promise<void> => {
        await callback({ telemetry: { properties: {}, measurements: {} }, errorHandling: {} });
    },
}));
jest.mock('./documentdb/ClustersExtension', (): object => ({
    ClustersExtension: jest.fn((): object => ({ activateClustersSupport: jest.fn() })),
}));
jest.mock('./documentdb/playground/PlaygroundDiagnostics', (): object => ({ PlaygroundDiagnostics: jest.fn() }));
jest.mock('./documentdb/playground/PlaygroundResultProvider', (): object => ({ PlaygroundResultProvider: jest.fn() }));
jest.mock('./documentdb/SchemaStore', (): object => ({ SchemaStore: { getInstance: jest.fn() } }));
jest.mock('./utils/readOnlyJsonDocumentProvider', (): object => ({ registerReadOnlyJsonDocumentProvider: jest.fn() }));
jest.mock('./utils/accumulatingTelemetry', (): object => ({ flushAccumulatedTelemetry: jest.fn() }));
jest.mock('./vscodeUriHandler', (): object => ({ globalUriHandler: jest.fn() }));
jest.mock('./services/migrationServices', (): object => ({ MigrationService: {} }));
jest.mock('./services/survey/invitation/SurveyInvitationView', (): object => ({
    initializeSurveyInvitation: jest.fn(),
}));
jest.mock('./services/survey/SurveyService', (): object => ({
    initializeSurveyService: jest.fn((): never => {
        throw new Error('Survey unavailable');
    }),
    getSurveyService: jest.fn(),
}));

it('registers working Give Feedback even when survey initialization throws during activation', async (): Promise<void> => {
    const context = { subscriptions: [], secrets: {} } as unknown as vscode.ExtensionContext;
    await activateInternal(context, { loadStartTime: 0, loadEndTime: 1 });
    expect(initializeSurveyService).toHaveBeenCalled();
    const registration = jest
        .mocked(vscode.commands.registerCommand)
        .mock.calls.find(([command]): boolean => command === GIVE_FEEDBACK_COMMAND);
    expect(registration).toBeDefined();
    await registration?.[1]();
    expect(vscode.env.openExternal).toHaveBeenCalledWith(SURVEY_FORM_URL);
});
