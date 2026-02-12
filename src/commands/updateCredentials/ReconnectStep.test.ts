/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ReconnectStep } from './ReconnectStep';
import { type UpdateCredentialsWizardContext } from './UpdateCredentialsWizardContext';

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

// Mock refreshView
const mockRefreshView = jest.fn().mockResolvedValue(undefined);
jest.mock('../refreshView/refreshView', () => ({
    refreshView: (...args: unknown[]) => mockRefreshView(...args),
}));

// Mock Views
jest.mock('../../documentdb/Views', () => ({
    Views: {
        ConnectionsView: 'connectionsView',
    },
}));

// Mock extensionVariables (needed for refreshView internals and resetNodeErrorState)
const mockResetNodeErrorState = jest.fn();
jest.mock('../../extensionVariables', () => ({
    ext: {
        connectionsBranchDataProvider: {
            resetNodeErrorState: (...args: unknown[]) => mockResetNodeErrorState(...args),
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
        isErrorState: false,
        reconnectAfterError: false,
        ...overrides,
    } as UpdateCredentialsWizardContext;
}

describe('ReconnectStep', () => {
    let step: ReconnectStep<UpdateCredentialsWizardContext>;

    beforeEach(() => {
        jest.clearAllMocks();
        step = new ReconnectStep();
    });

    describe('shouldExecute', () => {
        it('should always return true to ensure cache is cleared after credential update', () => {
            expect(step.shouldExecute()).toBe(true);
        });
    });

    describe('execute', () => {
        it('should always delete cached client and credentials and refresh the view', async () => {
            const context = createMockContext({
                clusterId: 'my-cluster-id',
                reconnectAfterError: false,
            });

            await step.execute(context);

            expect(mockDeleteClient).toHaveBeenCalledWith('my-cluster-id');
            expect(mockDeleteCredentials).toHaveBeenCalledWith('my-cluster-id');
            expect(mockRefreshView).toHaveBeenCalledWith(context, 'connectionsView');
        });

        it('should reset error state and set telemetry when reconnectAfterError is true', async () => {
            const context = createMockContext({
                reconnectAfterError: true,
                nodeId: 'test-node-id',
            });

            await step.execute(context);

            expect(mockResetNodeErrorState).toHaveBeenCalledWith('test-node-id');
            expect(context.telemetry.properties.reconnected).toBe('true');
        });

        it('should not reset error state or set telemetry when reconnectAfterError is false', async () => {
            const context = createMockContext({ reconnectAfterError: false });

            await step.execute(context);

            expect(mockResetNodeErrorState).not.toHaveBeenCalled();
            expect(context.telemetry.properties.reconnected).toBeUndefined();
        });
    });

    describe('priority', () => {
        it('should have priority 200 (after ExecuteStep which has priority 100)', () => {
            expect(step.priority).toBe(200);
        });
    });
});
