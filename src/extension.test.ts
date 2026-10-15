/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, it, vi } from 'vitest';

import * as vscode from 'vscode';
import { GIVE_FEEDBACK_COMMAND } from './commands/giveFeedback/giveFeedback';
import { activateInternal } from './extension';
import { initializeSurveyService } from './services/survey/SurveyService';
import { SURVEY_FORM_URL } from './services/survey/surveyConfig';

vi.mock('vscode', (): object => ({
    ExtensionMode: { Production: 1, Development: 2, Test: 3 },
    commands: { registerCommand: vi.fn((): object => ({ dispose: vi.fn() })) },
    window: { createOutputChannel: vi.fn(), registerUriHandler: vi.fn(), showErrorMessage: vi.fn() },
    workspace: {
        registerTextDocumentContentProvider: vi.fn(),
        getConfiguration: (): object => ({ get: vi.fn((_key: string, fallback?: unknown): unknown => fallback) }),
    },
    env: { openExternal: vi.fn().mockResolvedValue(true) },
    Uri: { parse: (value: string): string => value },
    l10n: { t: (value: string): string => value },
}));
vi.mock('@microsoft/vscode-azext-azureutils', (): object => ({ registerAzureUtilsExtensionVariables: vi.fn() }));
vi.mock('@microsoft/vscode-azext-utils', (): object => ({
    TreeElementStateManager: vi.fn(),
    createAzExtLogOutputChannel: (): object => ({ error: vi.fn() }),
    registerUIExtensionVariables: vi.fn(),
    registerErrorHandler: vi.fn(),
    createApiProvider: vi.fn(),
    callWithTelemetryAndErrorHandling: async (
        _name: string,
        callback: (context: object) => Promise<void>,
    ): Promise<void> => {
        await callback({ telemetry: { properties: {}, measurements: {} }, errorHandling: {} });
    },
}));
vi.mock('./documentdb/ClustersExtension', (): object => ({
    ClustersExtension: vi.fn(function (): object {
        return { activateClustersSupport: vi.fn() };
    }),
}));
vi.mock('./documentdb/playground/PlaygroundDiagnostics', (): object => ({ PlaygroundDiagnostics: vi.fn() }));
vi.mock('./documentdb/playground/PlaygroundResultProvider', (): object => ({
    PLAYGROUND_RESULT_SCHEME: 'documentdb-playground-result',
    PlaygroundResultProvider: vi.fn(),
}));
vi.mock('./documentdb/SchemaStore', (): object => ({ SchemaStore: { registerForDisposal: vi.fn() } }));
vi.mock('./utils/readOnlyJsonDocumentProvider', (): object => ({ registerReadOnlyJsonDocumentProvider: vi.fn() }));
vi.mock('./utils/accumulatingTelemetry', (): object => ({ flushAccumulatedTelemetry: vi.fn() }));
vi.mock('./vscodeUriHandler', (): object => ({ globalUriHandler: vi.fn() }));
vi.mock('./services/migrationServices', (): object => ({ MigrationService: {} }));
vi.mock('./services/survey/invitation/SurveyInvitationView', (): object => ({
    initializeSurveyInvitation: vi.fn(),
}));
vi.mock('./services/survey/SurveyService', (): object => ({
    initializeSurveyService: vi.fn((): never => {
        throw new Error('Survey unavailable');
    }),
    getSurveyService: vi.fn(),
}));

it('registers working Give Feedback even when survey initialization throws during activation', async (): Promise<void> => {
    const context = { subscriptions: [], secrets: {} } as unknown as vscode.ExtensionContext;
    await activateInternal(context, { loadStartTime: 0, loadEndTime: 1 });
    expect(initializeSurveyService).toHaveBeenCalled();
    const registration = vi
        .mocked(vscode.commands.registerCommand)
        .mock.calls.find(([command]): boolean => command === GIVE_FEEDBACK_COMMAND);
    expect(registration).toBeDefined();
    await registration?.[1]();
    expect(vscode.env.openExternal).toHaveBeenCalledWith(SURVEY_FORM_URL);
});
