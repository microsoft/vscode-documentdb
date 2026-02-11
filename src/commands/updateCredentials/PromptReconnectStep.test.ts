/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PromptReconnectStep } from './PromptReconnectStep';
import { type UpdateCredentialsWizardContext } from './UpdateCredentialsWizardContext';

// Mock @vscode/l10n
jest.mock('@vscode/l10n', () => ({
    t: jest.fn((str: string) => str),
}));

// Mock @microsoft/vscode-azext-utils
jest.mock('@microsoft/vscode-azext-utils', () => ({
    AzureWizardPromptStep: class {},
}));

function createMockContext(
    mockShowQuickPick: jest.Mock,
    overrides: Partial<UpdateCredentialsWizardContext> = {},
): UpdateCredentialsWizardContext {
    return {
        telemetry: { properties: {}, measurements: {} },
        errorHandling: { issueProperties: {} },
        valuesToMask: [],
        ui: {
            showQuickPick: mockShowQuickPick,
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
        hasActiveSession: true,
        shouldReconnect: false,
        ...overrides,
    } as UpdateCredentialsWizardContext;
}

describe('PromptReconnectStep', () => {
    let step: PromptReconnectStep;
    let mockShowQuickPick: jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();
        step = new PromptReconnectStep();
        mockShowQuickPick = jest.fn();
    });

    describe('shouldPrompt', () => {
        it('should return true when there is an active session', () => {
            const context = createMockContext(mockShowQuickPick, { hasActiveSession: true });
            expect(step.shouldPrompt(context)).toBe(true);
        });

        it('should return false when there is no active session', () => {
            const context = createMockContext(mockShowQuickPick, { hasActiveSession: false });
            expect(step.shouldPrompt(context)).toBe(false);
        });
    });

    describe('prompt', () => {
        it('should set shouldReconnect to true when user selects Yes', async () => {
            mockShowQuickPick.mockResolvedValue({
                label: 'Yes',
                data: true,
            });
            const context = createMockContext(mockShowQuickPick);

            await step.prompt(context);

            expect(context.shouldReconnect).toBe(true);
            expect(mockShowQuickPick).toHaveBeenCalledTimes(1);
        });

        it('should set shouldReconnect to false when user selects No', async () => {
            mockShowQuickPick.mockResolvedValue({
                label: 'No',
                data: false,
            });
            const context = createMockContext(mockShowQuickPick);

            await step.prompt(context);

            expect(context.shouldReconnect).toBe(false);
            expect(mockShowQuickPick).toHaveBeenCalledTimes(1);
        });

        it('should present two options to the user', async () => {
            let capturedItems: Array<{ label: string; data: boolean }> = [];
            mockShowQuickPick.mockImplementation((items: Array<{ label: string; data: boolean }>) => {
                capturedItems = items;
                return Promise.resolve(items[0]);
            });
            const context = createMockContext(mockShowQuickPick);

            await step.prompt(context);

            expect(capturedItems).toHaveLength(2);
            expect(capturedItems[0].data).toBe(true);
            expect(capturedItems[1].data).toBe(false);
        });

        it('should use detail instead of description for QuickPick items', async () => {
            let capturedItems: Array<{ label: string; detail?: string; description?: string; data: boolean }> = [];
            mockShowQuickPick.mockImplementation(
                (items: Array<{ label: string; detail?: string; description?: string; data: boolean }>) => {
                    capturedItems = items;
                    return Promise.resolve(items[0]);
                },
            );
            const context = createMockContext(mockShowQuickPick);

            await step.prompt(context);

            for (const item of capturedItems) {
                expect(item.detail).toBeDefined();
                expect(item.description).toBeUndefined();
            }
        });

        it('should pass correct options to showQuickPick', async () => {
            mockShowQuickPick.mockResolvedValue({
                label: 'Yes',
                data: true,
            });
            const context = createMockContext(mockShowQuickPick);

            await step.prompt(context);

            expect(mockShowQuickPick).toHaveBeenCalledWith(
                expect.any(Array),
                expect.objectContaining({
                    stepName: 'promptReconnect',
                    suppressPersistence: true,
                }),
            );
        });
    });
});
