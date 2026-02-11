/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type UpdateCredentialsWizardContext } from './UpdateCredentialsWizardContext';
import { ReconnectStep } from './ReconnectStep';

// Mock ClustersClient
const mockDeleteClient = jest.fn().mockResolvedValue(undefined);
jest.mock('../../documentdb/ClustersClient', () => ({
    ClustersClient: {
        deleteClient: (...args: unknown[]) => mockDeleteClient(...args),
    },
}));

// Mock CredentialCache
const mockDeleteCredentials = jest.fn();
jest.mock('../../documentdb/CredentialCache', () => ({
    CredentialCache: {
        deleteCredentials: (...args: unknown[]) => mockDeleteCredentials(...args),
    },
}));

// Mock extensionVariables
const mockRefresh = jest.fn();
jest.mock('../../extensionVariables', () => ({
    ext: {
        connectionsBranchDataProvider: {
            get refresh() {
                return mockRefresh;
            },
        },
    },
}));

// Mock @microsoft/vscode-azext-utils
jest.mock('@microsoft/vscode-azext-utils', () => ({
    AzureWizardExecuteStep: class {},
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

describe('ReconnectStep', () => {
    let step: ReconnectStep;

    beforeEach(() => {
        jest.clearAllMocks();
        step = new ReconnectStep();
    });

    describe('shouldExecute', () => {
        it('should return true when shouldReconnect is true', () => {
            const context = createMockContext({ shouldReconnect: true });
            expect(step.shouldExecute(context)).toBe(true);
        });

        it('should return false when shouldReconnect is false', () => {
            const context = createMockContext({ shouldReconnect: false });
            expect(step.shouldExecute(context)).toBe(false);
        });
    });

    describe('execute', () => {
        it('should delete cached client and credentials and refresh the view', async () => {
            const context = createMockContext({
                clusterId: 'my-cluster-id',
                shouldReconnect: true,
            });

            await step.execute(context);

            expect(mockDeleteClient).toHaveBeenCalledWith('my-cluster-id');
            expect(mockDeleteCredentials).toHaveBeenCalledWith('my-cluster-id');
            expect(mockRefresh).toHaveBeenCalled();
        });

        it('should set reconnected telemetry property to true', async () => {
            const context = createMockContext({ shouldReconnect: true });

            await step.execute(context);

            expect(context.telemetry.properties.reconnected).toBe('true');
        });
    });

    describe('priority', () => {
        it('should have priority 200 (after ExecuteStep which has priority 100)', () => {
            expect(step.priority).toBe(200);
        });
    });
});
