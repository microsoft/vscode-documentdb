/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type UpdateCredentialsWizardContext } from './UpdateCredentialsWizardContext';
import { PromptReconnectStep } from './PromptReconnectStep';

// Mock @vscode/l10n
jest.mock('@vscode/l10n', () => ({
    t: jest.fn((str: string) => str),
}));

// Mock @microsoft/vscode-azext-utils
jest.mock('@microsoft/vscode-azext-utils', () => ({
    AzureWizardPromptStep: class {},
}));

function createMockContext(overrides: Partial<UpdateCredentialsWizardContext> = {}): UpdateCredentialsWizardContext {
    return {
        telemetry: { properties: {}, measurements: {} },
        errorHandling: { issueProperties: {} },
        valuesToMask: [],
        ui: {
            showQuickPick: jest.fn(),
            showInputBox: jest.fn(),
            showWarningMessage: jest.fn(),
            onDidFinishPrompt: jest.fn(),
            showOpenDialog: jest.fn(),
            showWorkspaceFolderPick: jest.fn(),
        },
        isEmulator: false,
        storageId: 'test-storage-id',
        clusterId: 'test-cluster-id',
        availableAuthenticationMethods: [],
        shouldReconnect: false,
        ...overrides,
    } as UpdateCredentialsWizardContext;
}

describe('PromptReconnectStep', () => {
    let step: PromptReconnectStep;

    beforeEach(() => {
        jest.clearAllMocks();
        step = new PromptReconnectStep();
    });

    describe('shouldPrompt', () => {
        it('should always return true', () => {
            expect(step.shouldPrompt()).toBe(true);
        });
    });

    describe('prompt', () => {
        it('should set shouldReconnect to true when user selects Yes', async () => {
            const context = createMockContext();

            (context.ui.showQuickPick as jest.Mock).mockResolvedValue({
                label: 'Yes',
                data: true,
            });

            await step.prompt(context);

            expect(context.shouldReconnect).toBe(true);
            expect(context.ui.showQuickPick).toHaveBeenCalledTimes(1);
        });

        it('should set shouldReconnect to false when user selects No', async () => {
            const context = createMockContext();

            (context.ui.showQuickPick as jest.Mock).mockResolvedValue({
                label: 'No',
                data: false,
            });

            await step.prompt(context);

            expect(context.shouldReconnect).toBe(false);
            expect(context.ui.showQuickPick).toHaveBeenCalledTimes(1);
        });

        it('should present two options to the user', async () => {
            const context = createMockContext();

            let capturedItems: Array<{ label: string; data: boolean }> = [];
            (context.ui.showQuickPick as jest.Mock).mockImplementation(
                (items: Array<{ label: string; data: boolean }>) => {
                    capturedItems = items;
                    return Promise.resolve(items[0]);
                },
            );

            await step.prompt(context);

            expect(capturedItems).toHaveLength(2);
            expect(capturedItems[0].data).toBe(true);
            expect(capturedItems[1].data).toBe(false);
        });

        it('should pass correct options to showQuickPick', async () => {
            const context = createMockContext();

            (context.ui.showQuickPick as jest.Mock).mockResolvedValue({
                label: 'Yes',
                data: true,
            });

            await step.prompt(context);

            expect(context.ui.showQuickPick).toHaveBeenCalledWith(
                expect.any(Array),
                expect.objectContaining({
                    stepName: 'promptReconnect',
                    suppressPersistence: true,
                }),
            );
        });
    });
});
